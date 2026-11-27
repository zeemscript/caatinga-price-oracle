import {OracleError, PriceData, ContractEvent} from './types.js';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional: Client is both the typed interface and the ContractClient subclass that dispatches its methods via Proxy.
export interface Client {
  /**
   * In-place upgrade entry point required by `ctg upgrade`. Takes
   * *only* `new_wasm_hash` -- no extra `caller` parameter -- because
   * `ctg upgrade` always invokes exactly `upgrade --new_wasm_hash
   * <hash>` with `--source-account <admin-alias>` and nothing else;
   * there is no way to pass an additional CLI arg through that
   * command. Authorization instead comes from requiring a signature
   * from the address stored as admin, which is exactly the account
   * `--source` signs for. (A `caller: Address` parameter -- the
   * pattern used by every other admin-gated method here -- makes
   * `ctg upgrade` fail with a generic CAATINGA_INVOKE_FAILED and no
   * indication that the extra argument is the problem.)
   */
  upgrade(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, OracleError>>>;
  version(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<string, OracleError>>>;
  get_price(args: { asset: string }, options?: MethodOptions): Promise<AssembledTransaction<Result<PriceData, OracleError>>>;
  /**
   * v2: rotate the admin/signer key without redeploying or losing
   * price history. Both the outgoing and incoming admin must sign.
   */
  set_admin(args: { caller: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, OracleError>>>;
  /**
   * Admin-gated price push. Idempotent on `timestamp`: a submission with
   * a timestamp that is not strictly newer than the one on record is a
   * safe no-op (returns `Ok(false)`) instead of overwriting state or
   * erroring -- this is what lets the backend's retry logic resubmit
   * after a timeout without double-applying the update.
   */
  set_price(args: { caller: string | Address; asset: string; price: bigint; timestamp: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, OracleError>>>;
  /**
   * One-time setup. The admin must sign this call (`require_auth`), so
   * only the deployer's chosen identity can claim the admin role.
   */
  initialize(args: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, OracleError>>>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional: Client is both the typed interface and the ContractClient subclass that dispatches its methods via Proxy.
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAAAAAAAFUHJpY2UAAAAAAAABAAAAEQ==", "AAAAAQAAAAAAAAAAAAAACVByaWNlRGF0YQAAAAAAAAIAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==", "AAAABAAAAAAAAAAAAAAAC09yYWNsZUVycm9yAAAAAAYAAAAlaW5pdGlhbGl6ZSgpIGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LgAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAQAAACZpbml0aWFsaXplKCkgd2FzIGNhbGxlZCBhIHNlY29uZCB0aW1lLgAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAgAAACBjYWxsZXIgaXMgbm90IHRoZSBjdXJyZW50IGFkbWluLgAAAAxVbmF1dGhvcml6ZWQAAAADAAAAN2dldF9wcmljZSgpIGNhbGxlZCBmb3IgYW4gYXNzZXQgd2l0aCBubyByZWNvcmRlZCBwcmljZS4AAAAADUFzc2V0Tm90Rm91bmQAAAAAAAAEAAAAI3NldF9wcmljZSgpIGNhbGxlZCB3aXRoIHByaWNlIDw9IDAuAAAAAAxJbnZhbGlkUHJpY2UAAAAFAAAANHYyOiBzZXRfcHJpY2UoKSBjYWxsZWQgd2l0aCBhIHByaWNlIGFib3ZlIE1BWF9QUklDRS4AAAAQUHJpY2VPdXRPZkJvdW5kcwAAAAY=", "AAAABQAAAHlFbWl0dGVkIG9uIGV2ZXJ5IGFwcGxpZWQgKG5vbi1zdGFsZSkgYHNldF9wcmljZWAgY2FsbC4gSW5kZXhlZCBvZmYtY2hhaW4KYnkgdGhlIGJhY2tlbmQgdG8gYnVpbGQgcXVlcnlhYmxlIHByaWNlIGhpc3RvcnkuAAAAAAAAAAAAAAtQcmljZVVwZGF0ZQAAAAABAAAADHByaWNlX3VwZGF0ZQAAAAMAAAAAAAAABWFzc2V0AAAAAAAAEQAAAAEAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAAAg==", "AAAAAAAAAqNJbi1wbGFjZSB1cGdyYWRlIGVudHJ5IHBvaW50IHJlcXVpcmVkIGJ5IGBjdGcgdXBncmFkZWAuIFRha2VzCipvbmx5KiBgbmV3X3dhc21faGFzaGAgLS0gbm8gZXh0cmEgYGNhbGxlcmAgcGFyYW1ldGVyIC0tIGJlY2F1c2UKYGN0ZyB1cGdyYWRlYCBhbHdheXMgaW52b2tlcyBleGFjdGx5IGB1cGdyYWRlIC0tbmV3X3dhc21faGFzaAo8aGFzaD5gIHdpdGggYC0tc291cmNlLWFjY291bnQgPGFkbWluLWFsaWFzPmAgYW5kIG5vdGhpbmcgZWxzZTsKdGhlcmUgaXMgbm8gd2F5IHRvIHBhc3MgYW4gYWRkaXRpb25hbCBDTEkgYXJnIHRocm91Z2ggdGhhdApjb21tYW5kLiBBdXRob3JpemF0aW9uIGluc3RlYWQgY29tZXMgZnJvbSByZXF1aXJpbmcgYSBzaWduYXR1cmUKZnJvbSB0aGUgYWRkcmVzcyBzdG9yZWQgYXMgYWRtaW4sIHdoaWNoIGlzIGV4YWN0bHkgdGhlIGFjY291bnQKYC0tc291cmNlYCBzaWducyBmb3IuIChBIGBjYWxsZXI6IEFkZHJlc3NgIHBhcmFtZXRlciAtLSB0aGUKcGF0dGVybiB1c2VkIGJ5IGV2ZXJ5IG90aGVyIGFkbWluLWdhdGVkIG1ldGhvZCBoZXJlIC0tIG1ha2VzCmBjdGcgdXBncmFkZWAgZmFpbCB3aXRoIGEgZ2VuZXJpYyBDQUFUSU5HQV9JTlZPS0VfRkFJTEVEIGFuZCBubwppbmRpY2F0aW9uIHRoYXQgdGhlIGV4dHJhIGFyZ3VtZW50IGlzIHRoZSBwcm9ibGVtLikAAAAAB3VwZ3JhZGUAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAAtPcmFjbGVFcnJvcgA=", "AAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAAAAAAAQAAAAQ=", "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAALT3JhY2xlRXJyb3IA", "AAAAAAAAAAAAAAAJZ2V0X3ByaWNlAAAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAARAAAAAQAAA+kAAAfQAAAACVByaWNlRGF0YQAAAAAAB9AAAAALT3JhY2xlRXJyb3IA", "AAAAAAAAAHx2Mjogcm90YXRlIHRoZSBhZG1pbi9zaWduZXIga2V5IHdpdGhvdXQgcmVkZXBsb3lpbmcgb3IgbG9zaW5nCnByaWNlIGhpc3RvcnkuIEJvdGggdGhlIG91dGdvaW5nIGFuZCBpbmNvbWluZyBhZG1pbiBtdXN0IHNpZ24uAAAACXNldF9hZG1pbgAAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAALT3JhY2xlRXJyb3IA", "AAAAAAAAAT1BZG1pbi1nYXRlZCBwcmljZSBwdXNoLiBJZGVtcG90ZW50IG9uIGB0aW1lc3RhbXBgOiBhIHN1Ym1pc3Npb24gd2l0aAphIHRpbWVzdGFtcCB0aGF0IGlzIG5vdCBzdHJpY3RseSBuZXdlciB0aGFuIHRoZSBvbmUgb24gcmVjb3JkIGlzIGEKc2FmZSBuby1vcCAocmV0dXJucyBgT2soZmFsc2UpYCkgaW5zdGVhZCBvZiBvdmVyd3JpdGluZyBzdGF0ZSBvcgplcnJvcmluZyAtLSB0aGlzIGlzIHdoYXQgbGV0cyB0aGUgYmFja2VuZCdzIHJldHJ5IGxvZ2ljIHJlc3VibWl0CmFmdGVyIGEgdGltZW91dCB3aXRob3V0IGRvdWJsZS1hcHBseWluZyB0aGUgdXBkYXRlLgAAAAAAAAlzZXRfcHJpY2UAAAAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABWFzc2V0AAAAAAAAEQAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAl0aW1lc3RhbXAAAAAAAAAGAAAAAQAAA+kAAAABAAAH0AAAAAtPcmFjbGVFcnJvcgA=", "AAAAAAAAAIBPbmUtdGltZSBzZXR1cC4gVGhlIGFkbWluIG11c3Qgc2lnbiB0aGlzIGNhbGwgKGByZXF1aXJlX2F1dGhgKSwgc28Kb25seSB0aGUgZGVwbG95ZXIncyBjaG9zZW4gaWRlbnRpdHkgY2FuIGNsYWltIHRoZSBhZG1pbiByb2xlLgAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAC09yYWNsZUVycm9yAA=="]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJson = {
    upgrade : this.txFromJson<Result<null, OracleError>>,  version : this.txFromJson<number>,  get_admin : this.txFromJson<Result<string, OracleError>>,  get_price : this.txFromJson<Result<PriceData, OracleError>>,  set_admin : this.txFromJson<Result<null, OracleError>>,  set_price : this.txFromJson<Result<boolean, OracleError>>,  initialize : this.txFromJson<Result<null, OracleError>>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "PriceUpdate" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  priceUpdateEventFilter(topicValues?: { asset?: string }): string[] {
    return this.spec.eventTopicFilter("PriceUpdate", topicValues);
  }
}