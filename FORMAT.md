# The VRNM file format

VERNAM writes a single self-describing container. Everything needed to decrypt
(except the passphrase) lives in the file, so there is no sidecar, no database,
and old files keep opening after defaults change.

All integers are little-endian. Encrypted files use the extension `.vrn`.

## Header (54 bytes, plaintext)

| Offset | Size | Field | Notes |
|-------:|-----:|-------|-------|
| 0  | 4  | Magic | ASCII `VRNM` (`0x56 0x52 0x4E 0x4D`) |
| 4  | 1  | Version | `0x01` |
| 5  | 1  | KDF algorithm | `crypto_pwhash_ALG_ARGON2ID13` |
| 6  | 4  | Argon2 opslimit | uint32 LE |
| 10 | 4  | Argon2 memlimit | uint32 LE (bytes) |
| 14 | 16 | Argon2 salt | `crypto_pwhash_SALTBYTES` |
| 30 | 24 | secretstream header | `crypto_secretstream_xchacha20poly1305_HEADERBYTES` |

The header is plaintext by necessity (you need the salt and KDF cost to derive
the key) and reveals nothing sensitive: a salt, a stream nonce, and the work
factor are all non-secret by design.

## Body

Immediately after the header, a sequence of length-prefixed messages:

```
[len: uint32 LE][ciphertext: len bytes]   (repeated)
```

Each ciphertext is one `crypto_secretstream_xchacha20poly1305` message (it
includes its own 17-byte Poly1305 tag).

- **Message 0** is the encrypted metadata: UTF-8 JSON `{"n": <original name>, "s": <size>}`.
  Storing the name inside the stream keeps the original filename confidential and
  lets decryption restore it.
- **Messages 1..n** are the file contents in 1 MiB plaintext chunks.
- The **last message** carries `TAG_FINAL`. Anything missing it is treated as
  truncated. (An empty source file produces a single `TAG_FINAL` message after
  the metadata.)

## Cryptography

- **Key derivation:** Argon2id stretches the passphrase, with the per-file salt
  and the opslimit/memlimit recorded in the header, into a 256-bit key.
  - Standard profile: opslimit 3, memlimit 256 MiB.
  - High security profile: opslimit 4, memlimit 1 GiB.
- **Encryption + integrity:** XChaCha20-Poly1305 via libsodium's `secretstream`.
  Every chunk is authenticated, ordered, and bound to the stream, so a wrong
  passphrase, a flipped bit, a reordered chunk, or a truncated file all fail
  decryption cleanly. VERNAM never writes a partial output on failure.

## Direction detection

VERNAM sniffs the first 4 bytes. If they are `VRNM`, it decrypts; otherwise it
encrypts. That is the whole "which way?" logic.

## Interoperability

This format is stable and shared with the encryptor at
[privacytools.io/encrypt](https://www.privacytools.io/encrypt): a file encrypted
in one opens in the other. Any implementation that follows this document can read
and write VERNAM files.
