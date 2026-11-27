# Key management

This service needs one signing key: the Stellar account that is the oracle
contract's **admin**. The backend uses it to sign `set_price` and
`upgrade` transactions on its own, since there is no human present to
approve a wallet popup in an automation/relayer context.

## Where the key lives

- **Never committed.** `backend/.env` is gitignored (see `backend/.gitignore`).
  Only `backend/.env.example`, with placeholder values, is tracked.
- **Never printed.** The backend's logger (`backend/src/lib/logger.ts`)
  only ever logs the derived **public** key (`signerPublicKey`), never the
  secret. Grep the codebase for `ORACLE_SIGNER_SECRET` -- it is read once,
  in `backend/src/env.ts`, and passed straight into
  `Keypair.fromSecret(...)` in `backend/src/lib/signer.ts`. It is not
  logged, not persisted to SQLite, and not exposed by any HTTP endpoint.
- **Not Caatinga's responsibility.** Caatinga's own docs are explicit that
  it does not store private keys or perform silent signing -- deliberately.
  The `--source` flag to `ctg` commands is always a local Stellar CLI
  identity *alias* (e.g. `alice`), resolved from `~/.config/stellar/`,
  never a raw secret. Key custody for the *backend's own* automated
  signing is squarely the application's concern, which is what this
  document covers.

## Local development / demo

For a testnet demo, the simplest path is to reuse the same identity you
deployed with:

```bash
stellar keys show alice   # prints the S... secret for the local "alice" identity
```

Paste that into `backend/.env` as `ORACLE_SIGNER_SECRET`. This is fine for
a throwaway testnet key with no real value. **Do not do this with a
mainnet key.**

## Production guidance

- Put the secret in a real secrets manager (AWS Secrets Manager, GCP
  Secret Manager, HashiCorp Vault, etc.) and inject it as an environment
  variable at container-start time -- never bake it into an image layer
  or commit it in any form, encrypted or not, to the repository.
- Scope the admin key tightly: it can only call `set_price`, `set_admin`,
  and `upgrade` on this one contract. It is not a general-purpose Stellar
  account; do not fund it with more than it needs for fees, and do not
  reuse it for anything else.
- **Rotate without downtime.** The v2 contract adds `set_admin(new_admin)`
  specifically so the signing key can be rotated (e.g. after a suspected
  compromise, or as routine hygiene) without redeploying the contract or
  losing price history:
  1. Generate a new Stellar CLI identity and fund it.
  2. Call `oracle.set_admin` with the **current** admin as `--source` and
     the new address as the argument (both must sign: see the contract's
     `set_admin` doc comment).
  3. Update `backend/.env` with the new identity's secret and restart the
     backend (or redeploy it with the new secret already in place).
  4. Revoke/forget the old secret.
- Prefer a short-lived process identity over a long-lived container with
  the secret baked into its filesystem, where your infrastructure
  supports it.

## What a compromised signer key can and cannot do

Scoped by the contract itself, not by convention:

- **Can:** push arbitrary (but bounds-checked, as of v2) prices, rotate
  the admin to a different key, upgrade the contract's WASM.
- **Cannot:** drain funds (the contract holds none), impersonate other
  Soroban accounts, or affect any contract other than this one.

If you suspect compromise, call `set_admin` from the compromised key
*before* the attacker does (whoever submits first wins), or, if that
window has already passed, redeploy a fresh instance via
`ctg deploy oracle --upgrade` with a brand-new admin and repoint the
backend at it -- which is exactly the "resolve from artifacts, not a
hardcoded ID" design this service already relies on for the ordinary
upgrade path.
