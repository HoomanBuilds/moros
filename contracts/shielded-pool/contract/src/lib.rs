#![no_std]

extern crate alloc;

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contractevent, contractimpl, contracttype, log, symbol_short, token,
    vec,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};

use lean_imt::{Imt, LeanIMT, TREE_DEPTH_KEY, TREE_LEAVES_KEY, TREE_ROOT_KEY};
use zk::{Groth16Verifier, Proof, PublicSignals, VerificationKey};

#[cfg(test)]
mod test;

use soroban_sdk::contracterror;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    Yes,
    No,
    Void,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketInfo {
    pub asset: Symbol,
    pub threshold: i128,
    pub expiry: u64,
    pub finalize_after: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Pending,
    Included,
    Refunded,
    Redeemed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderRecord {
    pub owner: Address,
    pub stake: i128,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Order(BytesN<32>),
    Included(BytesN<32>),
}

#[contractclient(name = "MarketClient")]
pub trait Market {
    fn outcome(env: Env) -> Option<Outcome>;
    fn market_info(env: Env) -> MarketInfo;
    fn quote_batch(env: Env, dqyes: i128, dqno: i128) -> i128;
    fn apply_batch(env: Env, batcher: Address, dqyes: i128, dqno: i128) -> i128;
    fn price_yes(env: Env) -> i128;
    fn redeem(env: Env, trader: Address, side: Side) -> i128;
}

// Contract errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NullifierUsed = 1,
    InsufficientBalance = 2,
    CoinOwnershipProofFailed = 3,
    OnlyAdmin = 4,
    TreeAtCapacity = 5,
    AssociationRootMismatch = 6,
    DepositProofFailed = 7,
    CommitmentMismatch = 8,
    CapMismatch = 9,
    BatchProofFailed = 10,
    BatchMismatch = 11,
    OrderRootMismatch = 12,
    InvalidStake = 13,
    Unauthorized = 14,
    NotIncluded = 15,
    PriceMismatch = 16,
    AlreadyClaimed = 17,
    RedeemProofFailed = 18,
    MarketClosed = 19,
    OrderNotFound = 20,
    InvalidOrderState = 21,
    InvalidBatchSize = 22,
    FeeMismatch = 23,
    MarketVoided = 24,
    InvalidFee = 25,
    DuplicateOrder = 26,
    ConfigurationLocked = 27,
    LegacyBatchDisabled = 28,
    LegacyRedeemDisabled = 29,
}

// Error messages for Vec<String> returns (legacy compatibility)
pub const ERROR_NULLIFIER_USED: &str = "Nullifier already used";
pub const ERROR_INSUFFICIENT_BALANCE: &str = "Insufficient balance";
pub const ERROR_COIN_OWNERSHIP_PROOF: &str = "Couldn't verify coin ownership proof";
pub const ERROR_RECIPIENT_MISMATCH: &str = "Recipient does not match proof";
pub const ERROR_MARKET_UNRESOLVED: &str = "Market not resolved";
pub const ERROR_WRONG_OUTCOME: &str = "Note is not on the winning outcome";
pub const ERROR_WITHDRAW_SUCCESS: &str = "Withdrawal successful";
pub const ERROR_ONLY_ADMIN: &str = "Only the admin can set association root";
pub const SUCCESS_ASSOCIATION_ROOT_SET: &str = "Association root set successfully";

const TREE_DEPTH: u32 = 20;

// Storage keys
const NULL_KEY: Symbol = symbol_short!("null");
const VK_KEY: Symbol = symbol_short!("vk");
const TOKEN_KEY: Symbol = symbol_short!("token");
const ASSOCIATION_ROOT_KEY: Symbol = symbol_short!("assoc");
const ADMIN_KEY: Symbol = symbol_short!("admin");
const MARKET_KEY: Symbol = symbol_short!("market");
const DEPOSIT_VK_KEY: Symbol = symbol_short!("dvk");
const CAP_KEY: Symbol = symbol_short!("cap");
const ORDER_LEAVES_KEY: Symbol = symbol_short!("oleaves");
const ORDER_DEPTH_KEY: Symbol = symbol_short!("odepth");
const ORDER_ROOT_KEY: Symbol = symbol_short!("oroot");
const REDEEM_NULL_KEY: Symbol = symbol_short!("rnull");
const COMMITTEE_KEY: Symbol = symbol_short!("committee");
const COMMITTEE_T_KEY: Symbol = symbol_short!("commit_t");
const PRICE_KEY: Symbol = symbol_short!("pyes");
const BATCH_INCL_KEY: Symbol = symbol_short!("bincl");
const REDEEM_V2_VK_KEY: Symbol = symbol_short!("r2vk");
const DECIMALS_KEY: Symbol = symbol_short!("decimals");
const CLAIMED_KEY: Symbol = symbol_short!("claimed");
const TREASURY_KEY: Symbol = symbol_short!("treasury");
const FEE_BPS_KEY: Symbol = symbol_short!("fee_bps");
const ORDER_TREE_DEPTH: u32 = 16;
const BATCH_N: u32 = 4;
const MIN_PRIVATE_BATCH_N: u32 = 2;
const MAX_COMMITTEE_MEMBERS: u32 = 16;
const SCALE: i128 = 1 << 32;
const TTL_THRESHOLD: u32 = 120_960;
const TTL_EXTEND_TO: u32 = 6_307_200;

const FIXED_AMOUNT: i128 = 1000000000;
const MAX_FEE_BPS: u32 = 1_000;

#[contractevent(topics = ["order_placed"], data_format = "vec")]
pub struct OrderPlaced {
    #[topic]
    pub commitment: BytesN<32>,
    pub index: u32,
    pub stake: i128,
}

#[contractevent(topics = ["order_refund"], data_format = "vec")]
pub struct OrderRefunded {
    #[topic]
    pub commitment: BytesN<32>,
    #[topic]
    pub owner: Address,
    pub stake: i128,
}

#[contract]
pub struct PrivacyPoolsContract;

#[contractimpl]
impl PrivacyPoolsContract {
    pub fn __constructor(
        env: &Env,
        vk_bytes: Bytes,
        deposit_vk_bytes: Bytes,
        token_address: Address,
        admin: Address,
        market: Address,
        cap: i128,
        treasury: Address,
        fee_bps: u32,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic!("invalid fee configuration");
        }
        // Store the admin
        env.storage().instance().set(&ADMIN_KEY, &admin);

        env.storage().instance().set(&VK_KEY, &vk_bytes);
        env.storage()
            .instance()
            .set(&DEPOSIT_VK_KEY, &deposit_vk_bytes);
        env.storage().instance().set(&TOKEN_KEY, &token_address);
        env.storage().instance().set(&MARKET_KEY, &market);
        env.storage().instance().set(&CAP_KEY, &cap);
        env.storage().instance().set(&TREASURY_KEY, &treasury);
        env.storage().instance().set(&FEE_BPS_KEY, &fee_bps);
        let decimals = token::Client::new(env, &token_address).decimals();
        env.storage().instance().set(&DECIMALS_KEY, &decimals);

        // Initialize empty merkle tree with fixed depth
        let tree = LeanIMT::new(env, TREE_DEPTH);
        let (leaves, depth, root) = tree.to_storage();
        env.storage().instance().set(&TREE_LEAVES_KEY, &leaves);
        env.storage().instance().set(&TREE_DEPTH_KEY, &depth);
        env.storage().instance().set(&TREE_ROOT_KEY, &root);

        let order_tree = Imt::new(env, ORDER_TREE_DEPTH);
        env.storage()
            .instance()
            .set(&ORDER_LEAVES_KEY, &order_tree.frontier());
        env.storage().instance().set(&ORDER_DEPTH_KEY, &0u32);
        env.storage()
            .instance()
            .set(&ORDER_ROOT_KEY, &order_tree.get_root());
        Self::bump(env);
    }

    /// Stores a commitment in the merkle tree and updates the tree state
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `commitment` - The commitment to store
    ///
    /// # Returns
    /// * A Result containing a tuple of (updated_merkle_root, leaf_index) after insertion
    fn store_commitment(env: &Env, commitment: BytesN<32>) -> Result<(BytesN<32>, u32), Error> {
        // Load current tree state
        let leaves: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&TREE_LEAVES_KEY)
            .unwrap_or(vec![&env]);
        let depth: u32 = env.storage().instance().get(&TREE_DEPTH_KEY).unwrap_or(0);
        let root: BytesN<32> = env
            .storage()
            .instance()
            .get(&TREE_ROOT_KEY)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        // Create tree and insert new commitment
        let mut tree = LeanIMT::from_storage(env, leaves, depth, root);
        tree.insert(commitment).map_err(|_| Error::TreeAtCapacity)?;

        // Get the leaf index (it's the last leaf in the tree)
        let leaf_index = tree.get_leaf_count() - 1;

        // Store updated tree state
        let (new_leaves, new_depth, new_root) = tree.to_storage();
        env.storage().instance().set(&TREE_LEAVES_KEY, &new_leaves);
        env.storage().instance().set(&TREE_DEPTH_KEY, &new_depth);
        env.storage().instance().set(&TREE_ROOT_KEY, &new_root);

        Ok((new_root, leaf_index))
    }

    fn store_order(env: &Env, commitment: BytesN<32>) -> Result<(BytesN<32>, u32), Error> {
        let count: u32 = env.storage().instance().get(&ORDER_DEPTH_KEY).unwrap_or(0);
        let frontier: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ORDER_LEAVES_KEY)
            .unwrap_or(vec![env]);
        let root: BytesN<32> = env
            .storage()
            .instance()
            .get(&ORDER_ROOT_KEY)
            .unwrap_or(BytesN::from_array(env, &[0u8; 32]));
        let mut tree = Imt::from_storage(env, ORDER_TREE_DEPTH, count, frontier, root);
        let leaf_index = tree.insert(commitment).map_err(|_| Error::TreeAtCapacity)?;
        let new_root = tree.get_root();
        env.storage()
            .instance()
            .set(&ORDER_LEAVES_KEY, &tree.frontier());
        env.storage()
            .instance()
            .set(&ORDER_DEPTH_KEY, &tree.get_count());
        env.storage().instance().set(&ORDER_ROOT_KEY, &new_root);
        Ok((new_root, leaf_index))
    }

    pub fn place_order(
        env: &Env,
        from: Address,
        commitment: BytesN<32>,
        stake: i128,
    ) -> Result<u32, Error> {
        from.require_auth();
        if stake <= 0 {
            return Err(Error::InvalidStake);
        }
        if Self::stake_tokens(env, stake).is_none() {
            return Err(Error::InvalidStake);
        }
        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let market_client = MarketClient::new(env, &market);
        let info = market_client.market_info();
        if market_client.outcome().is_some() || env.ledger().timestamp() >= info.expiry {
            return Err(Error::MarketClosed);
        }
        let order_key = DataKey::Order(commitment.clone());
        if env.storage().persistent().has(&order_key) {
            return Err(Error::DuplicateOrder);
        }
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        token::Client::new(env, &token_address).transfer(
            &from,
            &env.current_contract_address(),
            &stake,
        );
        let (_, leaf_index) = Self::store_order(env, commitment.clone())?;
        env.storage().persistent().set(
            &order_key,
            &OrderRecord {
                owner: from,
                stake,
                status: OrderStatus::Pending,
            },
        );
        Self::bump_key(env, &order_key);
        Self::bump(env);
        OrderPlaced {
            commitment,
            index: leaf_index,
            stake,
        }
        .publish(env);
        Ok(leaf_index)
    }

    pub fn get_order(env: &Env, commitment: BytesN<32>) -> Option<OrderRecord> {
        let key = DataKey::Order(commitment);
        let order = env.storage().persistent().get(&key);
        if order.is_some() {
            Self::bump_key(env, &key);
        }
        order
    }

    pub fn refund_order(env: &Env, owner: Address, commitment: BytesN<32>) -> Result<i128, Error> {
        owner.require_auth();
        let key = DataKey::Order(commitment.clone());
        let mut order: OrderRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::OrderNotFound)?;
        if order.owner != owner {
            return Err(Error::Unauthorized);
        }
        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let client = MarketClient::new(env, &market);
        let refundable = match client.outcome() {
            Some(Outcome::Void) => {
                matches!(order.status, OrderStatus::Pending | OrderStatus::Included)
            }
            Some(_) => false,
            None => {
                let info = client.market_info();
                order.status == OrderStatus::Pending
                    && env.ledger().timestamp() >= info.finalize_after
            }
        };
        if !refundable {
            return Err(Error::InvalidOrderState);
        }
        order.status = OrderStatus::Refunded;
        env.storage().persistent().set(&key, &order);
        Self::bump_key(env, &key);
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        token::Client::new(env, &token_address).transfer(
            &env.current_contract_address(),
            &owner,
            &order.stake,
        );
        OrderRefunded {
            commitment,
            owner,
            stake: order.stake,
        }
        .publish(env);
        Self::bump(env);
        Ok(order.stake)
    }

    pub fn get_order_root(env: &Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&ORDER_ROOT_KEY)
            .unwrap_or(BytesN::from_array(env, &[0u8; 32]))
    }

    /// Deposits funds into the privacy pool and stores a commitment in the merkle tree.
    ///
    /// This function allows a user to deposit a fixed amount (1 XLM) of the configured token into the privacy pool
    /// while providing a cryptographic commitment that will be used for zero-knowledge proof
    /// verification during withdrawal.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment
    /// * `from` - The address of the depositor (must be authenticated)
    /// * `commitment` - A 32-byte cryptographic commitment that will be used to prove
    ///                 ownership during withdrawal without revealing the actual coin details
    ///
    /// # Returns
    ///
    /// * The leaf index where the commitment was stored in the merkle tree
    ///
    /// # Security
    ///
    /// * Requires authentication from the `from` address
    /// * The commitment is stored in a merkle tree for efficient inclusion proofs
    /// * Transfers exactly `FIXED_AMOUNT` of the configured token from the depositor to the contract
    ///
    /// # Storage
    ///
    /// * Updates the merkle tree with the new commitment
    /// * Transfers the asset from the depositor to the contract
    pub fn deposit(
        env: &Env,
        from: Address,
        commitment: BytesN<32>,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Result<u32, Error> {
        from.require_auth();

        let dvk_bytes: Bytes = env.storage().instance().get(&DEPOSIT_VK_KEY).unwrap();
        let dvk = VerificationKey::from_bytes(env, &dvk_bytes).unwrap();
        let proof = Proof::from_bytes(env, &proof_bytes);
        let pub_signals = PublicSignals::from_bytes(env, &pub_signals_bytes);

        let res = Groth16Verifier::verify_proof(env, dvk, proof, &pub_signals.pub_signals);
        if res.is_err() || !res.unwrap() {
            return Err(Error::DepositProofFailed);
        }

        if pub_signals.pub_signals.get(0).unwrap().to_bytes() != commitment {
            return Err(Error::CommitmentMismatch);
        }

        let cap: i128 = env.storage().instance().get(&CAP_KEY).unwrap();
        let mut cap_bytes = [0u8; 32];
        cap_bytes[16..].copy_from_slice(&cap.to_be_bytes());
        if pub_signals.pub_signals.get(1).unwrap().to_bytes() != BytesN::from_array(env, &cap_bytes)
        {
            return Err(Error::CapMismatch);
        }

        // Get the stored token address
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();

        // Create token client and transfer from depositor to contract
        let token_client = token::Client::new(env, &token_address);
        token_client.transfer(&from, &env.current_contract_address(), &FIXED_AMOUNT);

        // Store the commitment in the merkle tree
        let (_, leaf_index) = Self::store_commitment(env, commitment)?;

        Ok(leaf_index)
    }

    /// Withdraws funds from the privacy pool using a zero-knowledge proof.
    ///
    /// This function allows a user to withdraw a fixed amount (1 XLM) of the configured token from the privacy pool
    /// by providing a cryptographic proof that demonstrates ownership of a previously deposited
    /// commitment without revealing which specific commitment it corresponds to.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment
    /// * `to` - The address of the recipient (must be authenticated)
    /// * `proof_bytes` - The serialized zero-knowledge proof demonstrating ownership of a
    ///                   commitment without revealing the commitment itself
    /// * `pub_signals_bytes` - The serialized public signals associated with the proof
    ///
    /// # Returns
    ///
    /// Returns a vector containing status messages:
    /// * Empty vector `[]` on successful withdrawal (success is logged as a diagnostic event)
    /// * `["Nullifier already used"]` if the nullifier has been used before
    /// * `["Couldn't verify coin ownership proof"]` if the zero-knowledge proof verification fails
    /// * `["Insufficient balance"]` if the contract doesn't have enough funds
    ///
    /// # Security
    ///
    /// * Relayer-submittable: the recipient is bound in the proof, so no signature
    ///   from `to` is required and only the in-proof recipient can be paid
    /// * Verifies that the nullifier hasn't been used before (prevents double-spending)
    /// * Validates the zero-knowledge proof using Groth16 verification
    /// * Transfers exactly `FIXED_AMOUNT` of the configured token from the contract to the recipient
    ///
    /// # Storage
    ///
    /// * Adds the nullifier to the used nullifiers list to prevent reuse
    /// * Transfers the asset from the contract to the recipient
    ///
    /// # Privacy
    ///
    /// * The withdrawal doesn't reveal which specific commitment is being spent
    /// * The nullifier ensures the same commitment cannot be spent twice
    /// * The zero-knowledge proof proves ownership without revealing the commitment details
    pub fn withdraw(
        env: &Env,
        to: Address,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Vec<String> {
        // Require association root to be set before any withdrawal
        if !Self::has_association_set(env) {
            panic!("Association root must be set before withdrawal");
        }

        // Get the stored token address
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();

        // Check contract balance before updating state
        let token_client = token::Client::new(env, &token_address);
        let contract_balance = token_client.balance(&env.current_contract_address());
        if contract_balance < FIXED_AMOUNT {
            return vec![env, String::from_str(env, ERROR_INSUFFICIENT_BALANCE)];
        }

        let vk_bytes: Bytes = env.storage().instance().get(&VK_KEY).unwrap();
        let vk = VerificationKey::from_bytes(env, &vk_bytes).unwrap();
        let proof = Proof::from_bytes(env, &proof_bytes);
        let pub_signals = PublicSignals::from_bytes(env, &pub_signals_bytes);

        let nullifier_hash = &pub_signals.pub_signals.get(0).unwrap();
        let _withdrawn_value = &pub_signals.pub_signals.get(1).unwrap();
        let proof_root = &pub_signals.pub_signals.get(2).unwrap();
        let proof_association_root = &pub_signals.pub_signals.get(3).unwrap();
        let proof_recipient = &pub_signals.pub_signals.get(4).unwrap();
        let proof_winning = &pub_signals.pub_signals.get(7).unwrap();

        if Self::recipient_field(env, &to) != proof_recipient.to_bytes() {
            return vec![env, String::from_str(env, ERROR_RECIPIENT_MISMATCH)];
        }

        // Verify association set root matches the proof
        let stored_association_root = Self::get_association_root(env);
        let proof_association_root_bytes = proof_association_root.to_bytes();

        if stored_association_root != proof_association_root_bytes {
            return vec![env, String::from_str(env, "Association set root mismatch")];
        }

        // Check if nullifier has been used before
        let mut nullifiers: Vec<BytesN<32>> =
            env.storage().instance().get(&NULL_KEY).unwrap_or(vec![env]);

        let nullifier = nullifier_hash.to_bytes();

        if nullifiers.contains(&nullifier) {
            return vec![env, String::from_str(env, ERROR_NULLIFIER_USED)];
        }

        // Verify state root matches
        let state_root: BytesN<32> = env
            .storage()
            .instance()
            .get(&TREE_ROOT_KEY)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        let proof_root_bytes = proof_root.to_bytes();

        if state_root != proof_root_bytes {
            return vec![env, String::from_str(env, ERROR_COIN_OWNERSHIP_PROOF)];
        }

        // Verify the zero-knowledge proof
        let res = Groth16Verifier::verify_proof(env, vk, proof, &pub_signals.pub_signals);
        if res.is_err() || !res.unwrap() {
            return vec![env, String::from_str(env, ERROR_COIN_OWNERSHIP_PROOF)];
        }

        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let winning: u8 = match MarketClient::new(env, &market).outcome() {
            Some(Outcome::Yes) => 1,
            Some(Outcome::No) => 0,
            Some(Outcome::Void) => {
                return vec![env, String::from_str(env, ERROR_MARKET_UNRESOLVED)]
            }
            None => return vec![env, String::from_str(env, ERROR_MARKET_UNRESOLVED)],
        };
        let mut winning_bytes = [0u8; 32];
        winning_bytes[31] = winning;
        if proof_winning.to_bytes() != BytesN::from_array(env, &winning_bytes) {
            return vec![env, String::from_str(env, ERROR_WRONG_OUTCOME)];
        }

        // Add nullifier to used nullifiers only after all checks pass
        nullifiers.push_back(nullifier);
        env.storage().instance().set(&NULL_KEY, &nullifiers);

        // Transfer the asset from the contract to the recipient
        token_client.transfer(&env.current_contract_address(), &to, &FIXED_AMOUNT);

        // Log success message as diagnostic event
        log!(&env, "{}", ERROR_WITHDRAW_SUCCESS);

        vec![env]
    }

    /// Gets the current merkle root of the commitment tree
    pub fn get_merkle_root(env: &Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&TREE_ROOT_KEY)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]))
    }

    /// Gets the current depth of the merkle tree
    pub fn get_merkle_depth(env: &Env) -> u32 {
        env.storage().instance().get(&TREE_DEPTH_KEY).unwrap_or(0)
    }

    /// Gets the number of commitments (leaves) in the merkle tree
    pub fn get_commitment_count(env: &Env) -> u32 {
        let leaves: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&TREE_LEAVES_KEY)
            .unwrap_or(vec![&env]);
        leaves.len() as u32
    }

    /// Gets all commitments (leaves) in the merkle tree
    pub fn get_commitments(env: &Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&TREE_LEAVES_KEY)
            .unwrap_or(vec![env])
    }

    pub fn get_nullifiers(env: &Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&NULL_KEY).unwrap_or(vec![env])
    }

    /// Gets the balance of the configured token held by the contract
    pub fn get_balance(env: &Env) -> i128 {
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let token_client = token::Client::new(env, &token_address);
        token_client.balance(&env.current_contract_address())
    }

    fn recipient_field(env: &Env, to: &Address) -> BytesN<32> {
        let hash = env.crypto().sha256(&to.clone().to_xdr(env));
        let mut arr = hash.to_array();
        arr[0] &= 0x1f;
        BytesN::from_array(env, &arr)
    }

    /// Validates that the caller is the admin
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment
    /// * `caller` - The address to validate as admin
    ///
    /// # Returns
    ///
    /// * `true` if the caller is the admin, `false` otherwise
    fn is_admin(env: &Env, caller: &Address) -> bool {
        let admin: Address = env.storage().instance().get(&ADMIN_KEY).unwrap();
        *caller == admin
    }

    /// Sets the association set root for compliance verification
    ///
    /// This function allows the admin to update the association set root,
    /// which is used to verify that withdrawals are associated with approved
    /// subsets of deposits for compliance purposes.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment
    /// * `caller` - The address of the caller (must be authenticated and be the admin)
    /// * `association_root` - The new association set root (32-byte hash)
    ///
    /// # Returns
    ///
    /// Returns a vector containing status messages:
    /// * `["Association root set successfully"]` on successful update
    /// * `["Only the admin can set association root"]` if the caller is not the admin
    ///
    /// # Security
    ///
    /// * Requires authentication from the caller
    /// * Only the contract deployer (admin) can update association sets
    pub fn set_association_root(
        env: &Env,
        caller: Address,
        association_root: BytesN<32>,
    ) -> Vec<String> {
        caller.require_auth();

        // Verify that the caller is actually the admin
        if !Self::is_admin(env, &caller) {
            return vec![env, String::from_str(env, ERROR_ONLY_ADMIN)];
        }

        env.storage()
            .instance()
            .set(&ASSOCIATION_ROOT_KEY, &association_root);
        vec![env, String::from_str(env, SUCCESS_ASSOCIATION_ROOT_SET)]
    }

    /// Gets the current association set root
    ///
    /// # Returns
    ///
    /// * The current association set root, or zero bytes if not set
    pub fn get_association_root(env: &Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&ASSOCIATION_ROOT_KEY)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]))
    }

    /// Checks if an association set is currently configured
    ///
    /// # Returns
    ///
    /// * `true` if an association set root is configured, `false` otherwise
    pub fn has_association_set(env: &Env) -> bool {
        let association_root = Self::get_association_root(env);
        let zero_root = BytesN::from_array(&env, &[0u8; 32]);
        association_root != zero_root
    }

    /// Gets the admin address (the contract deployer)
    ///
    /// # Returns
    ///
    /// * The address of the admin (contract deployer)
    pub fn get_admin(env: &Env) -> Address {
        env.storage().instance().get(&ADMIN_KEY).unwrap()
    }

    pub fn market(env: &Env) -> Address {
        env.storage().instance().get(&MARKET_KEY).unwrap()
    }

    pub fn collateral(env: &Env) -> Address {
        env.storage().instance().get(&TOKEN_KEY).unwrap()
    }

    pub fn protocol_version(_env: &Env) -> u32 {
        3
    }

    pub fn security_config(env: &Env) -> (Vec<Address>, u32, bool) {
        (
            env.storage()
                .instance()
                .get(&COMMITTEE_KEY)
                .unwrap_or(vec![env]),
            env.storage()
                .instance()
                .get(&COMMITTEE_T_KEY)
                .unwrap_or(0),
            env.storage().instance().has(&REDEEM_V2_VK_KEY),
        )
    }

    pub fn set_batch_vk(_env: &Env, _caller: Address, _vk_bytes: Bytes) -> Result<(), Error> {
        Err(Error::LegacyBatchDisabled)
    }

    pub fn submit_batch(
        _env: &Env,
        _dqyes: i128,
        _dqno: i128,
        _proof_bytes: Bytes,
        _pub_signals_bytes: Bytes,
    ) -> Result<i128, Error> {
        Err(Error::LegacyBatchDisabled)
    }

    fn field_of_i128(env: &Env, n: i128) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[16..].copy_from_slice(&n.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }

    fn i128_of_field(fld: &BytesN<32>) -> i128 {
        let arr = fld.to_array();
        let mut b = [0u8; 16];
        b.copy_from_slice(&arr[16..32]);
        i128::from_be_bytes(b)
    }

    pub fn set_committee(
        env: &Env,
        caller: Address,
        members: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&ADMIN_KEY).unwrap();
        if caller != admin {
            return Err(Error::OnlyAdmin);
        }
        if env.storage().instance().has(&COMMITTEE_KEY) {
            return Err(Error::ConfigurationLocked);
        }
        if members.is_empty()
            || members.len() > MAX_COMMITTEE_MEMBERS
            || threshold <= members.len() / 2
            || members.len() < threshold
        {
            return Err(Error::InvalidStake);
        }
        let mut unique: Vec<Address> = vec![env];
        for member in members.iter() {
            if unique.contains(&member) {
                return Err(Error::InvalidStake);
            }
            unique.push_back(member);
        }
        env.storage().instance().set(&COMMITTEE_KEY, &members);
        env.storage().instance().set(&COMMITTEE_T_KEY, &threshold);
        Ok(())
    }

    pub fn submit_batch_committee(
        env: &Env,
        signers: Vec<Address>,
        dqyes: i128,
        dqno: i128,
        null_hashes: Vec<BytesN<32>>,
        commitments: Vec<BytesN<32>>,
    ) -> Result<i128, Error> {
        let batch_len = null_hashes.len();
        if batch_len < MIN_PRIVATE_BATCH_N
            || batch_len > BATCH_N
            || commitments.len() != batch_len
        {
            return Err(Error::InvalidBatchSize);
        }
        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let client = MarketClient::new(env, &market);
        let info = client.market_info();
        let now = env.ledger().timestamp();
        if client.outcome().is_some() || now >= info.finalize_after {
            return Err(Error::MarketClosed);
        }
        if now < info.expiry && batch_len != BATCH_N {
            return Err(Error::InvalidBatchSize);
        }
        let members: Vec<Address> = env
            .storage()
            .instance()
            .get(&COMMITTEE_KEY)
            .ok_or(Error::Unauthorized)?;
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&COMMITTEE_T_KEY)
            .ok_or(Error::Unauthorized)?;
        if signers.len() < threshold {
            return Err(Error::Unauthorized);
        }
        let mut seen: Vec<Address> = vec![env];
        for s in signers.iter() {
            if !members.contains(&s) || seen.contains(&s) {
                return Err(Error::Unauthorized);
            }
            s.require_auth();
            seen.push_back(s);
        }

        let mut included: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&BATCH_INCL_KEY)
            .unwrap_or(vec![env]);
        let mut index = 0;
        for nh in null_hashes.iter() {
            if included.contains(&nh) {
                return Err(Error::NullifierUsed);
            }
            let commitment = commitments.get(index).ok_or(Error::InvalidBatchSize)?;
            let order_key = DataKey::Order(commitment.clone());
            let mut order: OrderRecord = env
                .storage()
                .persistent()
                .get(&order_key)
                .ok_or(Error::OrderNotFound)?;
            if order.status != OrderStatus::Pending {
                return Err(Error::InvalidOrderState);
            }
            let included_key = DataKey::Included(nh.clone());
            if env.storage().persistent().has(&included_key) {
                return Err(Error::NullifierUsed);
            }
            order.status = OrderStatus::Included;
            env.storage().persistent().set(&order_key, &order);
            env.storage().persistent().set(&included_key, &commitment);
            Self::bump_key(env, &order_key);
            Self::bump_key(env, &included_key);
            included.push_back(nh);
            index += 1;
        }
        env.storage().instance().set(&BATCH_INCL_KEY, &included);

        let token: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let net = client.quote_batch(&dqyes, &dqno);
        let me = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token,
                    fn_name: symbol_short!("transfer"),
                    args: (me.clone(), market.clone(), net).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);
        client.apply_batch(&me, &dqyes, &dqno);
        let price = client.price_yes();
        env.storage().instance().set(&PRICE_KEY, &price);
        Self::bump(env);
        Ok(net)
    }

    pub fn get_price(env: &Env) -> i128 {
        env.storage().instance().get(&PRICE_KEY).unwrap_or(0)
    }

    pub fn fee_config(env: &Env) -> (Address, u32) {
        (
            env.storage().instance().get(&TREASURY_KEY).unwrap(),
            env.storage().instance().get(&FEE_BPS_KEY).unwrap_or(0),
        )
    }

    pub fn required_stake(env: &Env, amount: u32) -> Result<i128, Error> {
        let bucket = match amount {
            1 => 1,
            2..=5 => 5,
            6..=10 => 10,
            11..=25 => 25,
            26..=50 => 50,
            51..=100 => 100,
            101..=250 => 250,
            251..=500 => 500,
            501..=1_000 => 1_000,
            _ => return Err(Error::InvalidStake),
        };
        Self::tokens_to_atomic(env, bucket)
    }

    pub fn claim_winnings(env: &Env) -> Result<i128, Error> {
        if env.storage().instance().has(&CLAIMED_KEY) {
            return Err(Error::AlreadyClaimed);
        }
        Self::claim_market_winnings(env)
    }

    fn claim_market_winnings(env: &Env) -> Result<i128, Error> {
        if env.storage().instance().has(&CLAIMED_KEY) {
            return Ok(0);
        }
        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let client = MarketClient::new(env, &market);
        let side = match client.outcome() {
            Some(Outcome::Yes) => Side::Yes,
            Some(Outcome::No) => Side::No,
            Some(Outcome::Void) => return Err(Error::MarketVoided),
            None => return Err(Error::OrderRootMismatch),
        };
        let me = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: market.clone(),
                    fn_name: symbol_short!("redeem"),
                    args: (me.clone(), side).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);
        let got = client.redeem(&me, &side);
        env.storage().instance().set(&CLAIMED_KEY, &true);
        Ok(got)
    }

    pub fn set_redeem_v2_vk(env: &Env, caller: Address, vk_bytes: Bytes) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&ADMIN_KEY).unwrap();
        if caller != admin {
            return Err(Error::OnlyAdmin);
        }
        if env.storage().instance().has(&REDEEM_V2_VK_KEY) {
            return Err(Error::ConfigurationLocked);
        }
        env.storage().instance().set(&REDEEM_V2_VK_KEY, &vk_bytes);
        Ok(())
    }

    fn to_atomic(env: &Env, fp: i128) -> i128 {
        let decimals: u32 = env.storage().instance().get(&DECIMALS_KEY).unwrap_or(7);
        let mut pow: i128 = 1;
        let mut i = 0u32;
        while i < decimals {
            pow *= 10;
            i += 1;
        }
        (fp * pow) / SCALE
    }

    fn tokens_to_atomic(env: &Env, tokens: i128) -> Result<i128, Error> {
        let decimals: u32 = env.storage().instance().get(&DECIMALS_KEY).unwrap_or(7);
        tokens
            .checked_mul(10i128.checked_pow(decimals).ok_or(Error::InvalidStake)?)
            .ok_or(Error::InvalidStake)
    }

    fn stake_tokens(env: &Env, stake: i128) -> Option<i128> {
        let decimals: u32 = env.storage().instance().get(&DECIMALS_KEY).unwrap_or(7);
        let unit = 10i128.checked_pow(decimals)?;
        if stake % unit != 0 {
            return None;
        }
        let tokens = stake / unit;
        match tokens {
            1 | 5 | 10 | 25 | 50 | 100 | 250 | 500 | 1_000 => Some(tokens),
            _ => None,
        }
    }

    pub fn redeem_order_v2(
        env: &Env,
        to: Address,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Result<i128, Error> {
        let rvk_bytes: Bytes = env.storage().instance().get(&REDEEM_V2_VK_KEY).unwrap();
        let rvk = VerificationKey::from_bytes(env, &rvk_bytes).unwrap();
        let proof = Proof::from_bytes(env, &proof_bytes);
        let pub_signals = PublicSignals::from_bytes(env, &pub_signals_bytes);
        let res = Groth16Verifier::verify_proof(env, rvk, proof, &pub_signals.pub_signals);
        if res.is_err() || !res.unwrap() {
            return Err(Error::RedeemProofFailed);
        }

        let nullifier = pub_signals.pub_signals.get(0).unwrap().to_bytes();
        let payout_fp = Self::i128_of_field(&pub_signals.pub_signals.get(1).unwrap().to_bytes());
        let proof_commitment = pub_signals.pub_signals.get(2).unwrap().to_bytes();
        let proof_order_root = pub_signals.pub_signals.get(3).unwrap().to_bytes();
        let proof_recipient = pub_signals.pub_signals.get(4).unwrap().to_bytes();
        let proof_winning = pub_signals.pub_signals.get(5).unwrap().to_bytes();
        let proof_price = Self::i128_of_field(&pub_signals.pub_signals.get(6).unwrap().to_bytes());
        let fee_fp = Self::i128_of_field(&pub_signals.pub_signals.get(7).unwrap().to_bytes());
        let proof_fee_bps =
            Self::i128_of_field(&pub_signals.pub_signals.get(8).unwrap().to_bytes());
        let proof_stake = Self::i128_of_field(&pub_signals.pub_signals.get(9).unwrap().to_bytes());

        if payout_fp < 0 || fee_fp < 0 || proof_fee_bps < 0 || proof_stake <= 0 {
            return Err(Error::RedeemProofFailed);
        }

        if Self::recipient_field(env, &to) != proof_recipient {
            return Err(Error::CommitmentMismatch);
        }
        if proof_order_root != Self::get_order_root(env) {
            return Err(Error::OrderRootMismatch);
        }
        let stored_price: i128 = env
            .storage()
            .instance()
            .get(&PRICE_KEY)
            .ok_or(Error::PriceMismatch)?;
        if proof_price != stored_price {
            return Err(Error::PriceMismatch);
        }

        let market: Address = env.storage().instance().get(&MARKET_KEY).unwrap();
        let winning: i128 = match MarketClient::new(env, &market).outcome() {
            Some(Outcome::Yes) => 1,
            Some(Outcome::No) => 0,
            Some(Outcome::Void) => return Err(Error::MarketVoided),
            None => return Err(Error::OrderRootMismatch),
        };
        if proof_winning != Self::field_of_i128(env, winning) {
            return Err(Error::OrderRootMismatch);
        }

        let commitment: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::Included(nullifier.clone()))
            .ok_or(Error::NotIncluded)?;
        if proof_commitment != commitment {
            return Err(Error::CommitmentMismatch);
        }
        let order_key = DataKey::Order(commitment);
        let mut order: OrderRecord = env
            .storage()
            .persistent()
            .get(&order_key)
            .ok_or(Error::OrderNotFound)?;
        if order.status != OrderStatus::Included {
            return Err(Error::InvalidOrderState);
        }
        let stake_tokens = Self::stake_tokens(env, order.stake).ok_or(Error::InvalidStake)?;
        if proof_stake != stake_tokens {
            return Err(Error::InvalidStake);
        }
        let fee_bps: u32 = env.storage().instance().get(&FEE_BPS_KEY).unwrap_or(0);
        if proof_fee_bps != fee_bps as i128 {
            return Err(Error::FeeMismatch);
        }
        let mut redeem_nulls: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&REDEEM_NULL_KEY)
            .unwrap_or(vec![env]);
        if redeem_nulls.contains(&nullifier) {
            return Err(Error::NullifierUsed);
        }
        redeem_nulls.push_back(nullifier);
        env.storage()
            .instance()
            .set(&REDEEM_NULL_KEY, &redeem_nulls);
        order.status = OrderStatus::Redeemed;
        env.storage().persistent().set(&order_key, &order);
        Self::bump_key(env, &order_key);

        Self::claim_market_winnings(env)?;

        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let tok = token::Client::new(env, &token_address);
        let me = env.current_contract_address();
        let payout = Self::to_atomic(env, payout_fp);
        let fee = Self::to_atomic(env, fee_fp);
        if payout > 0 {
            tok.transfer(&me, &to, &payout);
        }
        if fee > 0 {
            let treasury: Address = env.storage().instance().get(&TREASURY_KEY).unwrap();
            tok.transfer(&me, &treasury, &fee);
        }
        Ok(payout)
    }

    pub fn extend_ttl(env: &Env) {
        Self::bump(env);
    }

    pub fn set_redeem_vk(_env: &Env, _caller: Address, _vk_bytes: Bytes) -> Result<(), Error> {
        Err(Error::LegacyRedeemDisabled)
    }

    pub fn redeem_order(
        env: &Env,
        _to: Address,
        _proof_bytes: Bytes,
        _pub_signals_bytes: Bytes,
    ) -> Vec<String> {
        vec![env, String::from_str(env, "Legacy redemption disabled")]
    }

    pub fn get_redeem_nullifiers(env: &Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&REDEEM_NULL_KEY)
            .unwrap_or(vec![env])
    }
}

impl PrivacyPoolsContract {
    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_key(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}
