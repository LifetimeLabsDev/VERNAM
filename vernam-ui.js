/*
 * VERNAM tool UI wiring. SINGLE SOURCE shared by the site (/encrypt) and the
 * standalone repo page (VERNAM.app / GitHub). Drives the shared card markup
 * (card.html) via vrn- classes; the crypto lives in the engine
 * (window.PTEncrypt, aliased window.Vernam in the public repo). Load AFTER
 * sodium.js, wordlist.js, and the engine. No build step, no dependencies.
 */
(function () {
  var E = window.Vernam || window.PTEncrypt;
  if (!E) return;
  var $ = function (id) { return document.getElementById(id); };
  if (!$('pt-drop')) return; // card not on this page

  var states = ['idle', 'form', 'working', 'done', 'error'];
  function show(s) {
    states.forEach(function (x) {
      var el = $('pt-state-' + x);
      if (el) el.classList.toggle('vrn-hidden', x !== s);
    });
  }

  var mode = 'encrypt';
  var file = null;
  var highSec = false;

  var fileInput = $('pt-file');
  var drop = $('pt-drop');
  var pass = $('pt-pass');

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('vrn-over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('vrn-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('vrn-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
  }

  async function loadFile(f) {
    file = f;
    mode = await E.detect(f);
    $('pt-name').textContent = f.name;
    $('pt-size').textContent = fmtSize(f.size);
    var enc = mode === 'encrypt';
    var badge = $('pt-badge');
    badge.textContent = enc ? 'Will encrypt' : 'Will decrypt';
    badge.className = 'vrn-badge ' + (enc ? 'vrn-badge--enc' : 'vrn-badge--dec');
    $('pt-go-pre').textContent = enc ? 'Encrypt with' : 'Decrypt with';
    $('pt-strength').classList.toggle('vrn-hidden', !enc);
    $('pt-hi-row').classList.toggle('vrn-hidden', !enc);
    pass.value = ''; refreshStrength();
    show('form');
    setTimeout(function () { pass.focus(); }, 50);
  }

  $('pt-remove').addEventListener('click', reset);
  Array.prototype.forEach.call(document.querySelectorAll('.pt-reset'), function (b) { b.addEventListener('click', reset); });
  function reset() {
    file = null; fileInput.value = ''; pass.value = '';
    highSec = false; setSwitch(false); refreshStrength(); show('idle');
  }

  // show / hide
  $('pt-eye').addEventListener('click', function () {
    pass.type = pass.type === 'password' ? 'text' : 'password';
  });

  // generate (six BIP39 words, ~66 bits)
  $('pt-gen').addEventListener('click', function () {
    pass.value = E.generatePassphrase(6);
    pass.type = 'text';
    refreshStrength();
  });

  // copy passphrase
  function attachCopy(btn, input) {
    if (!btn) return;
    var orig = btn.innerHTML;
    var done = function () {
      btn.innerHTML = '<svg class="vrn-icon-sm" style="color:var(--vrn-good)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      setTimeout(function () { btn.innerHTML = orig; }, 1200);
    };
    var fallback = function () {
      var wasPw = input.type === 'password';
      input.type = 'text'; input.select();
      try { document.execCommand('copy'); } catch (e) {}
      if (wasPw) input.type = 'password';
      if (window.getSelection) window.getSelection().removeAllRanges();
      done();
    };
    btn.addEventListener('click', function () {
      if (!input.value) { input.focus(); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done, fallback);
      } else { fallback(); }
    });
  }
  attachCopy($('pt-copy'), pass);

  // strength (entropy score 0..4, no crack-time)
  pass.addEventListener('input', refreshStrength);
  function refreshStrength() {
    var r = E.strength(pass.value);
    var fill = $('pt-mfill');
    fill.style.width = (r.score / 4) * 100 + '%';
    fill.style.background = r.score <= 1 ? '#e24b4a' : (r.score === 2 ? '#ef9f27' : '#34d399');
    $('pt-mleft').innerHTML = 'Strength: <b>' + (pass.value ? r.label : 'Empty') + '</b>';
  }

  // high security switch (updates spec chips + caption)
  var hi = $('pt-hi');
  function setSwitch(on) {
    highSec = on;
    hi.setAttribute('aria-checked', String(on));
    hi.firstElementChild.style.left = on ? '21px' : '3px';
    $('pt-chip-mem').textContent = on ? '1 GiB' : '256 MiB';
    $('pt-chip-pass').textContent = on ? '4 passes' : '3 passes';
    $('pt-hi-cap').textContent = on
      ? 'Maximum resistance: every brute-force guess costs an attacker roughly five times more time and memory. Slower, and it can fail on low-RAM devices.'
      : 'Standard protection, plenty for most files. Flip on to make each brute-force guess far costlier. Not recommended for low-RAM devices.';
    refreshStrength();
  }
  hi.addEventListener('click', function () { setSwitch(!highSec); });

  // go
  $('pt-go').addEventListener('click', run);
  pass.addEventListener('keydown', function (e) { if (e.key === 'Enter' && mode === 'decrypt') run(); });

  // scramble-decode the button label on hover (respects reduced motion)
  function scrambleHover(btn, spans) {
    spans = (spans || []).filter(Boolean);
    if (!btn || !spans.length) return;
    var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@';
    var INTERVAL = 27, STEP = 0.5;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timer = null, targets = [];
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function restore() { spans.forEach(function (s, i) { if (targets[i] != null) s.textContent = targets[i]; }); }
    btn.addEventListener('mouseenter', function () {
      if (reduce || timer) return;
      spans.forEach(function (s) {
        if (!s.dataset.wlock) {
          s.style.display = 'inline-block'; s.style.textAlign = 'center';
          s.style.whiteSpace = 'nowrap'; s.style.width = s.offsetWidth + 'px'; s.dataset.wlock = '1';
        }
      });
      targets = spans.map(function (s) { return s.textContent; });
      var total = targets.reduce(function (a, t) { return a + t.length; }, 0);
      var frame = 0;
      timer = setInterval(function () {
        var idx = 0;
        spans.forEach(function (s, si) {
          s.textContent = targets[si].split('').map(function (ch) {
            var locked = idx < frame; idx++;
            if (ch === ' ') return ' ';
            return locked ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }).join('');
        });
        if (frame >= total) { stop(); restore(); }
        frame += STEP;
      }, INTERVAL);
    });
    btn.addEventListener('mouseleave', function () { stop(); if (targets.length) restore(); });
  }
  scrambleHover($('pt-go'), [$('pt-go-label')]);
  scrambleHover($('pt-cta'), [$('pt-cta-label')]); // marketing CTA, site only (guarded)

  async function run() {
    if (!file) return;
    if (!pass.value) { pass.focus(); return; }
    show('working');
    var bar = $('pt-bar'); bar.style.width = '0%';
    var opts = {
      profile: highSec ? 'high' : 'standard',
      onStage: function (t) { $('pt-stage').textContent = t; $('pt-detail').textContent = t === 'Deriving key' ? 'Stretching your passphrase into a key. This is meant to be slow.' : file.name; },
      onProgress: function (frac) { bar.style.width = Math.round(frac * 100) + '%'; },
    };
    try {
      var res = mode === 'encrypt'
        ? await E.encryptFile(file, pass.value, opts)
        : await E.decryptFile(file, pass.value, opts);
      bar.style.width = '100%';
      $('pt-done-title').textContent = mode === 'encrypt' ? 'Encrypted' : 'Decrypted';
      var verb = res.streamed ? 'Saved as' : 'Downloaded';
      $('pt-done-msg').textContent = mode === 'encrypt'
        ? verb + ' ' + res.name + '. Keep your passphrase safe, there is no recovery.'
        : verb + ' ' + res.name + '.';
      show('done');
    } catch (e) {
      if (e && e.name === 'AbortError') { show('form'); return; }
      $('pt-error-msg').textContent = (e && e.message) ? e.message : 'Could not complete. Please try again.';
      show('error');
    }
  }
})();
