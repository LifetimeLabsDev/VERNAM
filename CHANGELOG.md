# Changelog

All notable changes to VERNAM are recorded here. Versions follow
[semantic versioning](https://semver.org): MAJOR.MINOR.PATCH.

The `.vrn` file format has its own version byte (currently `1`) inside each file,
independent of the tool version below; old files always keep opening.

## 1.0.0 (2026-06-16)

- First public release.
- Drag-and-drop file encryption, fully client-side, nothing uploaded.
- Argon2id key derivation + XChaCha20-Poly1305 secretstream, via vendored libsodium.
- Auto-detects encrypt vs decrypt, streams large files to disk, standard and high-security profiles.
