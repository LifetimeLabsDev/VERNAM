# Contributing to VERNAM

Thanks for your interest in VERNAM. First, an important boundary note that will save you time.

## This repository is generated

VERNAM is maintained at [PrivacyTools.io](https://www.privacytools.io), and most of what you see
here is produced automatically from that upstream source. This repo is the published copy that
VERNAM.app deploys from and that you can fork and self-host. It is not where the code is written.

The following files are SYNCED from upstream and should not be edited here, because the next sync
would overwrite your changes:

- `assets/js/vernam.js` (the crypto engine, exposes `window.Vernam`)
- `assets/js/vernam-ui.js` (the wiring that drives the tool card)
- `assets/js/wordlist.js` (the BIP-0039 passphrase wordlist)
- `assets/css/card.css` (the tool card styles)
- `assets/vendor/sodium.js` (vendored libsodium)
- the tool card markup inside `index.html`, and the marketing copy inside `index.html`

If you want to change any of those, the change belongs upstream at PrivacyTools.io, not in this repo.
The friendliest way to propose one is to open an issue here describing what you would like to see, and
we will make the change at the source so it flows into every copy.

## What you can edit here

These files are hand-maintained in this repo and are fair game for issues and pull requests:

- `LICENSE` and `THIRD-PARTY-LICENSES.txt` (only for genuine licensing corrections)
- `FORMAT.md` (the `.vrn` file format spec)
- `README.md` and this `CONTRIBUTING.md`
- the page shell of `index.html` outside the synced regions (head, meta, theme toggle, footer),
  `_headers`, `robots.txt`, `site.webmanifest`, and the favicon and icon assets

## The stable contract

Two things are meant to stay stable so other people can build on VERNAM:

- **The file format**, documented in [FORMAT.md](FORMAT.md). A `.vrn` file written by any compliant
  implementation opens in any other, including the live tool at privacytools.io/encrypt.
- **The engine API** (`window.Vernam`): `ready`, `encryptFile`, `decryptFile`, `detect`,
  `generatePassphrase`, and `strength`. See the README for a short usage example.

If you find a bug in either, please report it. Format and API changes are handled carefully because
they affect every existing encrypted file.

## Reporting issues

- **Security:** if you believe you have found a vulnerability, please report it privately rather than
  in a public issue, so a fix can ship before details are public.
- **Everything else:** open a regular issue. Clear steps to reproduce, your browser and version, and
  what you expected help a lot.

## Self-hosting

You are very welcome to host your own copy. There is no build step and no dependencies to install, it
is a handful of static files served from any static host. The one condition is the VERNAM License ask:
keep a visible, working link back to [PrivacyTools.io](https://www.privacytools.io) on any hosted or
distributed copy. See the [README](README.md) and [LICENSE](LICENSE) for the details.

Thank you for helping keep strong, free encryption available to everyone.
