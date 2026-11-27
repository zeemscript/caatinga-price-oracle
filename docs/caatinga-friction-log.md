# Caatinga friction log

Honest notes from building a real backend (an oracle relayer + event
indexer + REST API) against Caatinga, end to end, on real Stellar
testnet infrastructure. Nothing here is theoretical -- every item was hit
while actually running `ctg` commands and the backend against a live
deployment. Repro steps are in this repo's commit history and the demo
video.

We're filing the concrete, fixable ones as GitHub issues against
`Dione-b/caatinga` as well; this document is the narrative version.

## What worked well (so the rest of this reads as calibrated, not sour)

- **`caatinga.artifacts.json` as the single source of truth** is the
  right call and made the whole "resolve, don't hardcode" requirement
  almost trivial to satisfy correctly -- see `backend/src/lib/artifacts.ts`,
  which is ~15 lines because `@caatinga/client` already exports
  `resolveContractId()` doing the real work.
- **Generated bindings are genuinely good.** `priceUpdateEventFilter()`
  and `parseEvent()` on the generated `Client` saved us from hand-rolling
  XDR topic-filter encoding for the indexer -- that would have been the
  most error-prone part of this project otherwise.
- **`llms.txt` / `llms-full.txt` / `docs/for-llms.md`** made this an
  unusually fast integration for an agent-driven build. Having the full
  CLI reference, config schema, artifact schema, and error catalog in one
  self-contained file meant far fewer round trips guessing at behavior.
- **Error codes as a documented public API** (`CAATINGA_*`) is the right
  design and our backend's retry/classification logic
  (`backend/src/lib/errors.ts`) leans on it directly, exactly as intended.
- **`ctg doctor`** caught real, useful things (Stellar CLI version,
  Rust/wasm target, identity resolution) before we wasted a deploy cycle.

## Friction, in the order we hit it

### 1. `ctg upgrade`'s fixed CLI invocation locks you into one `upgrade()` signature -- permanently, per instance

**What happened:** We first wrote `upgrade(caller: Address, new_wasm_hash: BytesN<32>)`,
matching the explicit-`caller` pattern used by every other admin-gated
method in the contract (`set_price`, `set_admin`). `ctg upgrade` failed
with a generic `CAATINGA_INVOKE_FAILED`. Running the underlying `stellar
contract invoke` command directly surfaced the real reason: `ctg upgrade`
always shells out to exactly

```
stellar contract invoke --id <id> --source-account <source> --network <net> -- upgrade --new_wasm_hash <hash>
```

with no way to pass any other argument. So the contract's `upgrade`
function **must** be `upgrade(new_wasm_hash: BytesN<32>)` with no other
parameters, authorizing via the *stored* admin's `require_auth()` --
trusting that `--source-account` is that admin and therefore already
signed the transaction -- rather than via an explicit `caller` parameter.

**Impact:** this is not just a one-time mistake to fix and move on from.
Once a contract is deployed with a non-conforming `upgrade()` signature,
**`ctg upgrade` can never succeed against that instance again** -- you'd
need to upgrade it to fix the signature, but upgrading is exactly the
thing that's broken (the currently-*deployed* code's `upgrade` function
is what gets invoked, regardless of what your new WASM contains). The
only recovery is a full redeploy to a new contract ID
(`ctg deploy --upgrade`), which is a strictly bigger operation than the
in-place upgrade you meant to do, and loses nothing only because we
happened to design price history around contract-id-tagged rows rather
than assuming a stable ID.

**Suggested fix:** call this out prominently, with the exact signature,
in `docs/tutorials/contract-upgrade.md` (right now it's a one-line aside:
"contract must expose admin-gated `upgrade(new_wasm_hash)`"). Better:
have `ctg build`/`ctg doctor` lint the contract spec for an `upgrade`
function and warn if its parameter list is anything other than exactly
`(new_wasm_hash: BytesN<32>)`, *before* the user deploys it.

### 2. Network-sandboxed environments (proxied egress) break `ctg build/deploy/upgrade` outright

**What happened:** running inside this Claude Code cloud session (locked
down to an HTTP CONNECT proxy; no raw outbound DNS/TCP at all), every
`ctg` command that talks to Soroban RPC failed with:

```
Networking or low-level protocol error: HTTP error: error trying to
connect: dns error: failed to lookup address information: Name or
service not known
```

`strace` showed the Stellar CLI's HTTP client issuing a raw UDP DNS query
directly to `8.8.8.8`, bypassing `HTTPS_PROXY` entirely -- while `curl`
to the identical URL, in the identical shell, worked fine. This is
upstream Stellar CLI behavior (not Caatinga's code), but Caatinga has no
override point for it, so it surfaces as a Caatinga deploy failure with
no actionable hint.

**Workaround:** a ~60-line local HTTP-to-HTTPS forwarder process
(`requests`, which *does* honor proxy env vars) bound to `127.0.0.1`,
with the global Stellar CLI network alias repointed at it via
`stellar network add testnet --rpc-url http://127.0.0.1:<port> ...
--overwrite`. Not something a newcomer would arrive at unprompted.

**Suggested fix:** a `docs/troubleshooting.md` entry for "`dns error` /
`Name or service not known` behind a corporate proxy or sandboxed CI,"
naming the root cause (Stellar CLI's HTTP client proxy support) so users
don't spend time suspecting Caatinga's own networking code, which is
innocent here.

### 3. The *same* sandboxed-network problem recurs for `ctg generate`, with a different error and a different (easier) fix

**What happened:** `ctg deploy` succeeded (it shells out to the Stellar
CLI, see #2), but the following "Bindings generation failed" step threw
`fetch failed` from `npx @stellar/stellar-sdk generate`. That command
uses Node's native `fetch` (undici), which -- unlike `curl` or `axios` --
ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set and Node is
22.21+. Setting that one env var fixed it immediately, no forwarder
needed.

**Suggested fix:** since this is just one env var (not a forwarder hack),
it's an easy win to document next to the `CAATINGA_BINDINGS_FAILED` entry
in `docs/errors.md`: "if this fails with a bare `fetch failed` behind a
proxy, try `NODE_USE_ENV_PROXY=1`."

### 4. `@caatinga/client` cannot connect to an `http://` RPC endpoint at all

**What happened:** while working around #2, we pointed `caatinga.config.ts`'s
`rpcUrl` at our local `http://127.0.0.1:...` forwarder and tried to use
`@caatinga/client`'s `createCaatingaClient` against it (not just the raw
Stellar CLI). It threw immediately:

```
Error: Cannot connect to insecure Soroban RPC server if `allowHttp` isn't set
```

Tracing it: `CaatingaNetwork` (`packages/client/src/types.ts`) has exactly
three fields -- `name`, `rpcUrl`, `networkPassphrase` -- and
`createDefaultBindingAdapter`'s `createClient()` constructs the generated
binding's `Client` with exactly `{contractId, publicKey, rpcUrl,
networkPassphrase}`. There is no `allowHttp` field anywhere in the type,
so there is **no way**, from application code, to use `@caatinga/client`
against an `http://` RPC endpoint -- even though Stellar's own tooling
ships a default **`local`** network preset at `http://localhost:8000/rpc`
(visible via `stellar network ls --long`) for exactly this purpose. In
practice this means `@caatinga/client` cannot be used against a local
`stellar network container start` validator without a hard crash, which
feels like it should be a first-class, zero-friction local-dev path.

**Suggested fix:** add an optional `allowHttp?: boolean` to
`CaatingaNetwork`, threaded through to both the `rpc.Server` construction
(used internally and by any caller doing raw `getEvents`) and the
generated binding's `Client` constructor in
`createDefaultBindingAdapter`. We worked around this specific case for
our own demo by switching back to the real public HTTPS testnet RPC and
fixing #3 instead, but that option won't exist for anyone whose actual
target is a local/offline validator.

### 5. CLI alias-resolution collides with ordinary oracle data, every time

**What happened:** `ctg invoke`/`ctg read` try to resolve *any* bare
string argument of 3+ characters as a Stellar CLI identity alias before
treating it as a literal value. For a price oracle, essentially every
argument trips this: asset tickers (`XLM`, `BTC`) look exactly like
3-letter aliases, and even purely numeric values like a price
(`123450`) or a Unix timestamp hit the same heuristic and must be escaped
with a leading backslash (`\XLM`, `\123450`) or passed with
`--no-resolve-aliases`.

```
Method arg "asset" looks like a CLI identity alias but could not be
resolved to an Address.
```

This is mentioned once in `llms-full.txt`'s rules table, but without a
worked example of *how often* it actually fires for realistic data. (It
does **not** affect `@caatinga/client`/generated bindings, which take
typed JS values directly and never go through this string-parsing layer
-- but that distinction isn't obvious until you've hit both paths, and
all of our own manual CLI testing needed it while the backend code
itself never does.)

**Suggested fix:** a short "Escaping CLI arguments" section in
`docs/cli.md` with exactly this example (a ticker symbol and a numeric
value both needing `\`), so people manually exercising a contract via
the CLI don't lose time here.

### 6. Contract error "messages" are the `///` doc comment, not the variant name -- and that split is invisible

**What happened:** our `OracleError::AssetNotFound` had no doc comment.
At runtime, `@caatinga/client`'s unwrapped `CaatingaError.cause.message`
(and, underneath, `@stellar/stellar-sdk`'s `AssembledTransaction.parseError`,
`packages/contract/spec.js`) came back as an **empty string**, not the
variant name. Confusingly, the *generated TypeScript binding's* static
`OracleError` map in `types.ts` still showed a friendly `{4: {message:
"AssetNotFound"}}` -- generated at `ctg generate` time from the same XDR
spec, by a different code path that evidently *does* default to the
variant name. So the thing that looks like the canonical source of error
messages isn't what's actually used by `.unwrap()` / `.result` at
runtime, and the failure (an empty string) is silent.

We fixed it by adding a `///` doc comment to every `OracleError` variant
(see `contracts/oracle/src/lib.rs`), and changed our own error-handling
code to classify by numeric error *code* rather than decoded message text
regardless (`backend/src/lib/errors.ts`, `backend/src/relayer.ts`), which
we'd recommend regardless of this issue.

**Suggested fix:** call out, in `docs/errors.md` or a new "writing
`#[contracterror]` enums" note, that the doc comment is load-bearing for
the runtime message (not just documentation), and ideally have
`ctg build`/`ctg doctor` warn on a `#[contracterror]` variant with no doc
comment.

### 7. The same contract rejection surfaces under two different error codes depending on call path

**What happened:** a contract-level rejection reached via `read()`
(simulate-only) comes back as `CAATINGA_XDR_RESULT_FAILED`. The
*identical* rejection, reached via `invoke()`'s submit path, came back as
`CAATINGA_XDR_SUBMIT_FAILED` -- whose message still reads "transaction
simulation failed" internally. Docs are explicit that "automation must
key on the code, never message text," which is the right rule, but
following it strictly here means code that treats `XDR_RESULT_FAILED` as
"the contract said no" also needs to treat `XDR_SUBMIT_FAILED` the same
way for the identical condition reached through `invoke()`, which isn't
documented anywhere we found.

**Suggested fix:** either unify the code for a contract-level rejection
regardless of call path, or document the equivalence explicitly in
`docs/errors.md`.

### 8. (Upstream Stellar CLI, not Caatinga, but adjacent to `ctg doctor`'s remit) a misleading success message on failed friendbot funding

`stellar keys generate --network testnet --fund` printed `✅ Account
alice funded on "Test SDF Network ; September 2015"` directly after
logging a `WARN fund_address failed: ... dns error ...` for the same
call. The account was, in fact, not funded; we verified via Horizon and
funded it manually via a direct friendbot request. `ctg doctor` already
checks identity *resolution*; checking that the resolved identity also
*exists and is funded* on the target network -- not just that the alias
exists locally -- would have caught this before our first deploy
attempt, independent of whose bug the misleading message itself is.
