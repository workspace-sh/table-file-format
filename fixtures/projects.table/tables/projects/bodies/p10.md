# Encrypted vaults

Per-workspace end-to-end encryption. Each workspace gets its own
keypair; the user holds the private key, the cloud only sees
ciphertext.

## Why on-hold

The KMS choice is blocking everything else. Three candidates:

1. **Apple CloudKit + Keychain.** Free for Apple-platform users,
   zero-config sync of the private key between the user's devices.
   Useless for cross-platform users (web, Android).
2. **Passkeys + WebAuthn.** Cross-platform, no password to forget,
   but the threat model around device loss + recovery is fuzzy.
3. **Roll our own.** Maximum control, minimum free time.

Decision parked until Q3 — too many other things gate on the answer.
