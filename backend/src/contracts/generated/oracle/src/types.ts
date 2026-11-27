

    /**
 * Union: DataKey
 */
 export type DataKey =
  { tag: "Admin"; values: void } |
  { tag: "Price"; values: readonly [string] };

/**
 * Struct: PriceData
 */
export interface PriceData {
  price: bigint;
  timestamp: bigint;
}

/**
 * Error Enum: OracleError
 */
export const OracleError = {
  /**
   * initialize() has not been called yet.
   */
  1 : { message: "NotInitialized" },
  /**
   * initialize() was called a second time.
   */
  2 : { message: "AlreadyInitialized" },
  /**
   * caller is not the current admin.
   */
  3 : { message: "Unauthorized" },
  /**
   * get_price() called for an asset with no recorded price.
   */
  4 : { message: "AssetNotFound" },
  /**
   * set_price() called with price <= 0.
   */
  5 : { message: "InvalidPrice" },
  /**
   * v2: set_price() called with a price above MAX_PRICE.
   */
  6 : { message: "PriceOutOfBounds" }
}

export interface OracleError {
  message: string;
}

/**
 * Emitted on every applied (non-stale) `set_price` call. Indexed off-chain
 * by the backend to build queryable price history.
 */
export interface PriceUpdateEvent {
  name: "PriceUpdate";
  data: {
    asset: string;
    price?: bigint;
    timestamp?: bigint;
  };
}
    export type ContractEvent = PriceUpdateEvent;
    