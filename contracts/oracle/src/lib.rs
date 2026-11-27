#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

/// Bumped by hand when the WASM is upgraded in-place via `ctg upgrade`.
/// Because this is a compile-time constant (not storage), the new value
/// ships automatically with the upgraded WASM -- no migration needed.
const CONTRACT_VERSION: u32 = 3;

/// v2: sanity ceiling added so a misbehaving/compromised feed can't push an
/// absurd value on-chain. $1,000,000,000.00 at the 7-decimal scale used
/// throughout (10_000_000 units = $1.00).
const MAX_PRICE: i128 = 1_000_000_000 * 10_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Price(Symbol),
}

/// Emitted on every applied (non-stale) `set_price` call. Indexed off-chain
/// by the backend to build queryable price history.
#[contractevent]
pub struct PriceUpdate {
    #[topic]
    pub asset: Symbol,
    pub price: i128,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum OracleError {
    /// initialize() has not been called yet.
    NotInitialized = 1,
    /// initialize() was called a second time.
    AlreadyInitialized = 2,
    /// caller is not the current admin.
    Unauthorized = 3,
    /// get_price() called for an asset with no recorded price.
    AssetNotFound = 4,
    /// set_price() called with price <= 0.
    InvalidPrice = 5,
    /// v2: set_price() called with a price above MAX_PRICE.
    PriceOutOfBounds = 6,
}

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    /// One-time setup. The admin must sign this call (`require_auth`), so
    /// only the deployer's chosen identity can claim the admin role.
    pub fn initialize(env: Env, admin: Address) -> Result<(), OracleError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(OracleError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, OracleError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(OracleError::NotInitialized)
    }

    /// Admin-gated price push. Idempotent on `timestamp`: a submission with
    /// a timestamp that is not strictly newer than the one on record is a
    /// safe no-op (returns `Ok(false)`) instead of overwriting state or
    /// erroring -- this is what lets the backend's retry logic resubmit
    /// after a timeout without double-applying the update.
    pub fn set_price(
        env: Env,
        caller: Address,
        asset: Symbol,
        price: i128,
        timestamp: u64,
    ) -> Result<bool, OracleError> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(OracleError::NotInitialized)?;
        if caller != admin {
            return Err(OracleError::Unauthorized);
        }

        if price <= 0 {
            return Err(OracleError::InvalidPrice);
        }
        if price > MAX_PRICE {
            return Err(OracleError::PriceOutOfBounds);
        }

        let key = DataKey::Price(asset.clone());
        if let Some(existing) = env.storage().persistent().get::<_, PriceData>(&key) {
            if timestamp <= existing.timestamp {
                return Ok(false);
            }
        }

        let data = PriceData { price, timestamp };
        env.storage().persistent().set(&key, &data);

        PriceUpdate {
            asset,
            price,
            timestamp,
        }
        .publish(&env);

        Ok(true)
    }

    /// v2: rotate the admin/signer key without redeploying or losing
    /// price history. Both the outgoing and incoming admin must sign.
    pub fn set_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), OracleError> {
        caller.require_auth();
        new_admin.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(OracleError::NotInitialized)?;
        if caller != admin {
            return Err(OracleError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn get_price(env: Env, asset: Symbol) -> Result<PriceData, OracleError> {
        env.storage()
            .persistent()
            .get(&DataKey::Price(asset))
            .ok_or(OracleError::AssetNotFound)
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// In-place upgrade entry point required by `ctg upgrade`. Takes
    /// *only* `new_wasm_hash` -- no extra `caller` parameter -- because
    /// `ctg upgrade` always invokes exactly `upgrade --new_wasm_hash
    /// <hash>` with `--source-account <admin-alias>` and nothing else;
    /// there is no way to pass an additional CLI arg through that
    /// command. Authorization instead comes from requiring a signature
    /// from the address stored as admin, which is exactly the account
    /// `--source` signs for. (A `caller: Address` parameter -- the
    /// pattern used by every other admin-gated method here -- makes
    /// `ctg upgrade` fail with a generic CAATINGA_INVOKE_FAILED and no
    /// indication that the extra argument is the problem.)
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), OracleError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(OracleError::NotInitialized)?;
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, OracleContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn initializes_once() {
        let (_, admin, client) = setup();
        let err = client.try_initialize(&admin);
        assert!(err.is_err());
    }

    #[test]
    fn sets_and_reads_price() {
        let (env, admin, client) = setup();
        let asset = Symbol::new(&env, "XLM");
        let applied = client.set_price(&admin, &asset, &1_234_000i128, &1000u64);
        assert!(applied);

        let data = client.get_price(&asset);
        assert_eq!(data.price, 1_234_000i128);
        assert_eq!(data.timestamp, 1000u64);
    }

    #[test]
    fn stale_timestamp_is_a_noop_not_an_error() {
        let (env, admin, client) = setup();
        let asset = Symbol::new(&env, "XLM");
        client.set_price(&admin, &asset, &1_234_000i128, &1000u64);

        let applied_again = client.set_price(&admin, &asset, &9_999_000i128, &1000u64);
        assert!(!applied_again);

        let data = client.get_price(&asset);
        assert_eq!(data.price, 1_234_000i128, "stale write must not overwrite");
    }

    #[test]
    fn rejects_non_admin_caller() {
        let (env, _admin, client) = setup();
        let stranger = Address::generate(&env);
        let asset = Symbol::new(&env, "XLM");
        let result = client.try_set_price(&stranger, &asset, &100i128, &1u64);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_non_positive_price() {
        let (env, admin, client) = setup();
        let asset = Symbol::new(&env, "XLM");
        let result = client.try_set_price(&admin, &asset, &0i128, &1u64);
        assert!(result.is_err());
    }

    #[test]
    fn version_reports_current_constant() {
        let (_, _, client) = setup();
        assert_eq!(client.version(), CONTRACT_VERSION);
    }

    #[test]
    fn rejects_price_above_bounds() {
        let (env, admin, client) = setup();
        let asset = Symbol::new(&env, "XLM");
        let result = client.try_set_price(&admin, &asset, &(MAX_PRICE + 1), &1u64);
        assert!(result.is_err());
    }

    #[test]
    fn accepts_price_at_bounds() {
        let (env, admin, client) = setup();
        let asset = Symbol::new(&env, "XLM");
        let applied = client.set_price(&admin, &asset, &MAX_PRICE, &1u64);
        assert!(applied);
    }

    #[test]
    fn admin_rotation_transfers_control() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&admin, &new_admin);

        assert_eq!(client.get_admin(), new_admin);

        // Old admin can no longer write.
        let asset = Symbol::new(&env, "XLM");
        let result = client.try_set_price(&admin, &asset, &100i128, &1u64);
        assert!(result.is_err());

        // New admin can.
        let applied = client.set_price(&new_admin, &asset, &100i128, &1u64);
        assert!(applied);
    }

    #[test]
    fn rejects_admin_rotation_from_non_admin() {
        let (env, _admin, client) = setup();
        let stranger = Address::generate(&env);
        let another = Address::generate(&env);
        let result = client.try_set_admin(&stranger, &another);
        assert!(result.is_err());
    }
}
