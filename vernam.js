/*
 * VERNAM, a client-side file encryption engine.
 * Argon2id (key derivation) + XChaCha20-Poly1305 secretstream (authenticated
 * streaming encryption), via libsodium. Everything runs locally in the browser;
 * nothing is ever uploaded.
 *
 * Made by PrivacyTools.io, https://www.privacytools.io
 * Licensed under the VERNAM License (see LICENSE): do whatever you like,
 * just keep a visible, linked credit to https://www.privacytools.io on any
 * hosted or distributed copy.
 *
 * File format (VRNM):
 *   magic    4   "VRNM"
 *   version  1   = 1
 *   alg      1   = crypto_pwhash_ALG_ARGON2ID13
 *   opslimit 4   uint32 LE
 *   memlimit 4   uint32 LE
 *   salt    16   crypto_pwhash_SALTBYTES
 *   header  24   crypto_secretstream_xchacha20poly1305_HEADERBYTES
 *   body         repeated [len uint32 LE][ciphertext]
 *                msg 0 = metadata JSON {n:name, s:size}, then file chunks,
 *                last chunk carries TAG_FINAL.
 * Full spec: FORMAT.md
 */

(function () {
  'use strict';

  const MAGIC = Uint8Array.from([0x56, 0x52, 0x4e, 0x4d]); // "VRNM"
  const VERSION = 1;
  const EXT = '.vrn';
  const CHUNK = 1 << 20; // 1 MiB plaintext per secretstream message
  const HEADER_LEN = 54;
  // In-memory (Blob) fallback cap when the File System Access API is absent.
  const FALLBACK_MAX = 2 * 1024 * 1024 * 1024; // 2 GiB

  // KDF profiles. memlimit fits in uint32 (1 GiB = 1073741824).
  const PROFILES = {
    standard: { opslimit: 3, memlimit: 256 * 1024 * 1024 },
    high: { opslimit: 4, memlimit: 1024 * 1024 * 1024 },
  };

  let S = null; // libsodium, once ready

  async function ready() {
    if (S) return S;
    await window.sodium.ready;
    S = window.sodium;
    return S;
  }

  function u32le(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return b;
  }
  function rdU32le(buf, off) {
    return new DataView(buf.buffer, buf.byteOffset).getUint32(off, true);
  }

  function looksEncrypted(headBytes) {
    if (!headBytes || headBytes.length < 4) return false;
    for (let i = 0; i < 4; i++) if (headBytes[i] !== MAGIC[i]) return false;
    return true;
  }

  // Pick an output sink. Prefers streaming straight to disk (constant memory);
  // falls back to buffering a Blob, then a download. Returns {write, close}.
  async function makeSink(suggestedName) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName });
        const stream = await handle.createWritable();
        return {
          streaming: true,
          async write(chunk) { await stream.write(chunk); },
          async close() { await stream.close(); return null; },
          async abort() { try { await stream.abort(); } catch (e) {} },
        };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e; // user cancelled the save dialog
        // otherwise fall through to Blob fallback
      }
    }
    const parts = [];
    return {
      streaming: false,
      async write(chunk) { parts.push(chunk.slice()); },
      async close() {
        const blob = new Blob(parts, { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return blob.size;
      },
      async abort() {},
    };
  }

  async function readSlice(file, start, end) {
    const buf = await file.slice(start, end).arrayBuffer();
    return new Uint8Array(buf);
  }

  // Encrypt a File. opts: { profile, onProgress(fraction), onStage(text) }.
  async function encryptFile(file, passphrase, opts) {
    opts = opts || {};
    const s = await ready();
    const prof = PROFILES[opts.profile === 'high' ? 'high' : 'standard'];
    const total = file.size || 1;

    if (!window.showSaveFilePicker && file.size > FALLBACK_MAX) {
      throw new Error('This browser can only handle files up to 2 GiB. Try Chrome or Edge for larger files.');
    }

    if (opts.onStage) opts.onStage('Deriving key');
    await tick();
    const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
    const key = s.crypto_pwhash(
      s.crypto_secretstream_xchacha20poly1305_KEYBYTES,
      passphrase, salt, prof.opslimit, prof.memlimit, s.crypto_pwhash_ALG_ARGON2ID13
    );

    const init = s.crypto_secretstream_xchacha20poly1305_init_push(key);
    const state = init.state;
    const T_MSG = s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    const T_FIN = s.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

    const outName = file.name + EXT;
    const sink = await makeSink(outName);

    try {
      if (opts.onStage) opts.onStage('Encrypting');
      const head = new Uint8Array(HEADER_LEN);
      head.set(MAGIC, 0);
      head[4] = VERSION;
      head[5] = s.crypto_pwhash_ALG_ARGON2ID13;
      head.set(u32le(prof.opslimit), 6);
      head.set(u32le(prof.memlimit), 10);
      head.set(salt, 14);
      head.set(init.header, 30);
      await sink.write(head);

      // metadata message (filename + size), encrypted
      const meta = new TextEncoder().encode(JSON.stringify({ n: file.name, s: file.size }));
      let ct = s.crypto_secretstream_xchacha20poly1305_push(state, meta, null, T_MSG);
      await sink.write(u32le(ct.length));
      await sink.write(ct);

      if (file.size === 0) {
        ct = s.crypto_secretstream_xchacha20poly1305_push(state, new Uint8Array(0), null, T_FIN);
        await sink.write(u32le(ct.length));
        await sink.write(ct);
      } else {
        for (let off = 0; off < file.size; off += CHUNK) {
          const end = Math.min(off + CHUNK, file.size);
          const plain = await readSlice(file, off, end);
          const tag = end >= file.size ? T_FIN : T_MSG;
          ct = s.crypto_secretstream_xchacha20poly1305_push(state, plain, null, tag);
          await sink.write(u32le(ct.length));
          await sink.write(ct);
          if (opts.onProgress) opts.onProgress(end / total);
          await tick();
        }
      }
      const size = await sink.close();
      return { name: outName, streamed: sink.streaming, size: size };
    } catch (e) {
      await sink.abort();
      throw e;
    }
  }

  // Decrypt a File. opts: { onProgress, onStage }.
  async function decryptFile(file, passphrase, opts) {
    opts = opts || {};
    const s = await ready();

    if (file.size < HEADER_LEN) throw new Error('This is not a PrivacyTools.io encrypted file.');
    const head = await readSlice(file, 0, HEADER_LEN);
    if (!looksEncrypted(head)) throw new Error('This is not a PrivacyTools.io encrypted file.');
    const version = head[4];
    if (version !== VERSION) throw new Error('Unsupported file version.');
    const alg = head[5];
    const opslimit = rdU32le(head, 6);
    const memlimit = rdU32le(head, 10);
    const salt = head.subarray(14, 14 + s.crypto_pwhash_SALTBYTES);
    const sHeader = head.subarray(30, 30 + s.crypto_secretstream_xchacha20poly1305_HEADERBYTES);

    if (opts.onStage) opts.onStage('Deriving key');
    await tick();
    const key = s.crypto_pwhash(
      s.crypto_secretstream_xchacha20poly1305_KEYBYTES,
      passphrase, salt, opslimit, memlimit, alg
    );
    const state = s.crypto_secretstream_xchacha20poly1305_init_pull(sHeader, key);
    const T_FIN = s.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

    // Read the metadata message first (we need the original name to open the sink).
    let pos = HEADER_LEN;
    const total = file.size || 1;

    async function pullNext() {
      const lenBuf = await readSlice(file, pos, pos + 4);
      if (lenBuf.length < 4) throw new Error('The file is truncated or corrupted.');
      const len = rdU32le(lenBuf, 0);
      pos += 4;
      const ct = await readSlice(file, pos, pos + len);
      if (ct.length < len) throw new Error('The file is truncated or corrupted.');
      pos += len;
      const r = s.crypto_secretstream_xchacha20poly1305_pull(state, ct);
      if (!r) throw new Error('Wrong passphrase, or the file is corrupted or was tampered with.');
      return r;
    }

    if (opts.onStage) opts.onStage('Decrypting');
    let meta;
    try {
      const first = await pullNext();
      meta = JSON.parse(new TextDecoder().decode(first.message));
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error('Wrong passphrase, or the file is corrupted or was tampered with.');
      throw e;
    }
    const outName = (meta && meta.n) ? meta.n : stripExt(file.name);
    const sink = await makeSink(outName);

    try {
      let done = false;
      while (pos < file.size) {
        const r = await pullNext();
        await sink.write(r.message);
        if (opts.onProgress) opts.onProgress(pos / total);
        await tick();
        if (r.tag === T_FIN) { done = true; break; }
      }
      if (!done) throw new Error('The file is truncated or corrupted.');
      const size = await sink.close();
      return { name: outName, streamed: sink.streaming, size: size };
    } catch (e) {
      await sink.abort();
      throw e;
    }
  }

  function stripExt(name) {
    return name.endsWith(EXT) ? name.slice(0, -EXT.length) : name + '.decrypted';
  }

  // Yield to the event loop so the UI can paint progress.
  function tick() {
    return new Promise((r) => setTimeout(r, 0));
  }

  // Cryptographically strong passphrase generator. Prefers the full BIP-0039
  // wordlist (2048 words, 11 bits each) loaded from /js/wordlist.js; the small
  // list below is only a fallback if that file did not load.
  const WORDLIST = ('copper lantern saffron gravel willow tundra marble ember cipher nimbus ' +
    'quartz fathom cobalt meadow ardent falcon harbor ingot juniper kelp ' +
    'lumen mosaic nectar opal pewter ripple summit thorn umber velvet ' +
    'walnut zenith amber basalt cedar dapple flint glacier hazel iris').split(' ');

  function wordSource() {
    return (typeof window !== 'undefined' && window.PTWordlist && window.PTWordlist.length >= 256)
      ? window.PTWordlist
      : WORDLIST;
  }

  function generatePassphrase(words) {
    const list = wordSource();
    words = words || 6;
    // Rejection-sample so the modulo does not bias the word distribution.
    const out = [];
    const limit = Math.floor(0x100000000 / list.length) * list.length;
    const buf = new Uint32Array(1);
    while (out.length < words) {
      crypto.getRandomValues(buf);
      if (buf[0] >= limit) continue;
      out.push(list[buf[0] % list.length]);
    }
    return out.join('-');
  }

  // ---- Passphrase entropy estimate (for the strength bar) ----
  const COMMON = ('password passw0rd 123456 12345678 qwerty letmein admin ' +
    'welcome iloveyou abc123 111111 000000 dragon monkey hunter2 login ' +
    'master superman trustno1 starwars').split(' ');

  let WL_SET = null;
  function wordSet() {
    const list = wordSource();
    if (!WL_SET || WL_SET._n !== list.length) {
      WL_SET = Object.create(null);
      for (let i = 0; i < list.length; i++) WL_SET[list[i]] = 1;
      WL_SET._n = list.length;
    }
    return WL_SET;
  }

  // Analyze a passphrase. Returns { bits, exact }. `exact` is true only when we
  // can stand behind the number: an empty/common passphrase (reliably instant)
  // or one built entirely from known wordlist words (n * log2(listlen)). For
  // anything hand-typed we fall back to a rough char-class count and flag it
  // NOT exact, so the UI can decline to show a misleading crack time.
  function analyze(p) {
    if (!p) return { bits: 0, exact: true };
    const s = p.replace(/^\s+|\s+$/g, '');
    if (!s) return { bits: 0, exact: true };
    if (COMMON.indexOf(s.toLowerCase()) !== -1) return { bits: 0, exact: true };
    const toks = s.split(/[-\s]+/).filter(Boolean);
    if (toks.length >= 2) {
      const list = wordSource();
      const set = wordSet();
      let allIn = true;
      for (let i = 0; i < toks.length; i++) {
        if (!set[toks[i].toLowerCase()]) { allIn = false; break; }
      }
      if (allIn) return { bits: toks.length * Math.log2(list.length), exact: true };
    }
    let pool = 0;
    if (/[a-z]/.test(s)) pool += 26;
    if (/[A-Z]/.test(s)) pool += 26;
    if (/[0-9]/.test(s)) pool += 10;
    if (/[^A-Za-z0-9]/.test(s)) pool += 33;
    return { bits: s.length * Math.log2(pool || 1), exact: false };
  }

  function entropyBits(p) { return analyze(p).bits; }

  // Simple passphrase strength (score 0..4), based on estimated entropy only.
  // No crack-time claims, no profile dependence: just a rough bar for the UI.
  function strength(p) {
    if (!p) return { score: 0, label: 'Empty', bits: 0 };
    const bits = analyze(p).bits;
    let score, label;
    if (bits < 28) { score = 1; label = 'Weak'; }
    else if (bits < 45) { score = 2; label = 'Fair'; }
    else if (bits < 60) { score = 3; label = 'Good'; }
    else { score = 4; label = 'Strong'; }
    return { score: score, label: label, bits: Math.round(bits) };
  }

  window.PTEncrypt = {
    ready, encryptFile, decryptFile, looksEncrypted,
    generatePassphrase, strength, entropyBits, analyze,
    EXT, HEADER_LEN,
    async detect(file) {
      const head = await readSlice(file, 0, Math.min(4, file.size));
      return looksEncrypted(head) ? 'decrypt' : 'encrypt';
    },
  };
  window.Vernam = window.PTEncrypt;
})();
