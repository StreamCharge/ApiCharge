#![no_std]
use base64::engine::general_purpose;
use base64::Engine as _;
use core::str;
use serde::Deserialize;
use soroban_sdk::{
    contract, contracterror, contractimpl, log, symbol_short, token, Address, Bytes, BytesN, Env,
    String, Symbol,
};

#[contract]
pub struct ApiChargeContract;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ContractError {
    InitValuesAlreadySet = 1,
    DeserializationError = 2,
    QuoteExpired = 3,
    InvalidStartTime = 4,
    BuyerIsServer = 5,
    InvalidCurrency = 6,
    RouteQuoteTooLarge = 7,
    InvalidBase64 = 8,
    InvalidBase64Length = 9,
    Unauthorized = 10,
    InvalidFeePercentage = 11,
    PriceOverflow = 12,
    UpdatesDisabled = 13,
}

#[derive(Debug, Deserialize)]
struct RouteQuote<'a> {
    issueUnixTimestamp: i64,
    validityEndUnixTimestamp: i64,
    serverFundsRecipient: &'a str,
    microUnitPrice: u64,
    currency: u32,
    signingPubkey: &'a str,
    signingAddress: &'a str,
}

const OWNER: Symbol = symbol_short!("OWNER");
const XLMADDRESS: Symbol = symbol_short!("XLMADDR");
const USDCADDRESS: Symbol = symbol_short!("USDCADDR");
const EURCADDRESS: Symbol = symbol_short!("EURCADDR");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS"); // Basis points (1/100 of 1%)
const UPDATES_ENABLED: Symbol = symbol_short!("UPD_EN"); // Whether contract WASM upgrades are still allowed

// TTL configuration
const CONFIG_TTL_THRESHOLD: u32 = 1296000; // 15 days in ledgers (~5 seconds each)
const CONFIG_TTL_EXTEND: u32 = 5184000; // 60 days

#[contractimpl]
impl ApiChargeContract {
    /// Initialize the contract with owner and token addresses
    pub fn init(
        env: Env,
        owner_pubkey: Address,
        native_asset: Address,
        usdc_asset: Address,
        eurc_asset: Address,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&OWNER)
            || env.storage().instance().has(&XLMADDRESS)
            || env.storage().instance().has(&USDCADDRESS)
            || env.storage().instance().has(&EURCADDRESS)
        {
            return Err(ContractError::InitValuesAlreadySet);
        }

        env.storage().instance().set(&OWNER, &owner_pubkey);
        env.storage().instance().set(&XLMADDRESS, &native_asset);
        env.storage().instance().set(&USDCADDRESS, &usdc_asset);
        env.storage().instance().set(&EURCADDRESS, &eurc_asset);
        env.storage().instance().set(&FEE_BPS, &50u32); // Default 0.5% fee (50 basis points)
        env.storage().instance().set(&UPDATES_ENABLED, &true);

        // Extend TTL for the initial configuration
        Self::extend_ttl_if_needed(&env);

        Ok(())
    }

    /// Purchase a nanosubscription using the provided route quote
    pub fn buy(
        env: Env,
        route_quote: Bytes,
        route_quote_signature: BytesN<64>,
        requested_start_time: i64,
        buyer: Address,
    ) -> Result<(), ContractError> {
        buyer.require_auth();

        let route_quote_length = route_quote.len();
        if route_quote_length >= 2048 {
            return Err(ContractError::RouteQuoteTooLarge);
        }

        let route_quote_json = route_quote.to_buffer::<2048>();
        let route_quote_json = route_quote_json.as_slice();
        let (routeQuote, _): (RouteQuote, _) = serde_json_core::de::from_slice(route_quote_json)
            .map_err(|_| ContractError::DeserializationError)?;

        log!(&env, "Deserialized route quote");

        // Check the route quote signed by the issuer has not been tampered with
        let signing_pubkey = Self::decode_base64_to_bytes32(&env, &routeQuote.signingPubkey)?;

        env.crypto()
            .ed25519_verify(&signing_pubkey, &route_quote, &route_quote_signature);

        log!(&env, "Signature verified");

        // Check if the quote has expired
        let current_time = env.ledger().timestamp();
        let route_quote_validity_expiration: u64 =
            routeQuote.validityEndUnixTimestamp.try_into().unwrap();
        if current_time > route_quote_validity_expiration {
            return Err(ContractError::QuoteExpired);
        }
        log!(&env, "Quote not expired");

        // Check if the requested start time is valid
        if requested_start_time >= routeQuote.validityEndUnixTimestamp
            || requested_start_time < routeQuote.issueUnixTimestamp
        {
            return Err(ContractError::InvalidStartTime);
        }
        log!(&env, "Valid start time");

        // Check if the buyer is not the server address
        let address_string = String::from_str(&env, routeQuote.signingAddress);
        let server_signing_address = Address::from_string(&address_string);
        if buyer == server_signing_address {
            return Err(ContractError::BuyerIsServer);
        }
        log!(&env, "Buyer is not server");

        // Check if the currency is supported (0=XLM, 1=USDC, 2=EURC)
        if routeQuote.currency > 2 {
            return Err(ContractError::InvalidCurrency);
        }
        log!(&env, "Currency is supported: {}", routeQuote.currency);

        // Calculate the total amount to charge (including service fee)
        let price = routeQuote
            .microUnitPrice
            .checked_mul(10)
            .ok_or(ContractError::PriceOverflow)?;
        let service_fee = Self::calculate_service_fee(&env, price)?;
        let total_charge = price
            .checked_add(service_fee)
            .ok_or(ContractError::PriceOverflow)?;
        log!(&env, "Fee calculated");

        // Get the appropriate token contract details based on currency
        let token_address: Address = match routeQuote.currency {
            0 => env.storage().instance().get(&XLMADDRESS).unwrap(),
            1 => env.storage().instance().get(&USDCADDRESS).unwrap(),
            2 => env.storage().instance().get(&EURCADDRESS).unwrap(),
            _ => return Err(ContractError::InvalidCurrency), // This should never happen due to earlier check
        };
        let token = token::Client::new(&env, &token_address);
        let contract_address = env.current_contract_address();
        let total_charge_i128: i128 = total_charge as i128;
        let price_i128: i128 = price as i128;
        log!(&env, "Token client created");

        // Transfer the total amount to this contract
        token.transfer(&buyer, &contract_address, &total_charge_i128);
        log!(&env, "Funds transferred to contract");

        // Transfer the quote amount to the route recipient
        let server_address_string = String::from_str(&env, routeQuote.serverFundsRecipient);
        let server_address = Address::from_string(&server_address_string);
        token.transfer(&contract_address, &server_address, &price_i128);
        log!(&env, "Funds transferred to server");

        // Service fee stays in contract as the same currency type
        // No separate fee transfer needed - the difference between total_charge and price stays in contract

        // Emit purchase event for monitoring
        env.events().publish(
            (symbol_short!("purchase"),),
            (
                buyer.clone(),
                routeQuote.microUnitPrice,
                requested_start_time,
                service_fee,
            ),
        );

        Ok(())
    }

    /// Withdraw accumulated fees to a specified recipient
    pub fn withdraw_fees(
        env: Env,
        recipient: Address,
        amount: i128,
        currency: u32,
    ) -> Result<(), ContractError> {
        // Verify owner authorization
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();

        // Validate currency
        if currency > 2 {
            return Err(ContractError::InvalidCurrency);
        }

        // Get the appropriate token contract based on currency
        let token_address: Address = match currency {
            0 => env.storage().instance().get(&XLMADDRESS).unwrap(),
            1 => env.storage().instance().get(&USDCADDRESS).unwrap(),
            2 => env.storage().instance().get(&EURCADDRESS).unwrap(),
            _ => return Err(ContractError::InvalidCurrency),
        };

        let token = token::Client::new(&env, &token_address);
        let contract_address = env.current_contract_address();

        token.transfer(&contract_address, &recipient, &amount);

        log!(
            &env,
            "Withdrew {} of currency {} to {}",
            amount,
            currency,
            recipient
        );

        // Extend TTL when owner interacts with contract
        Self::extend_ttl_if_needed(&env);

        Ok(())
    }

    /// Update the fee percentage (in basis points)
    pub fn update_fee_percentage(env: Env, new_fee_bps: u32) -> Result<(), ContractError> {
        // Verify owner authorization
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();

        // Validate fee percentage (max 10% = 1000 basis points)
        if new_fee_bps > 1000 {
            return Err(ContractError::InvalidFeePercentage);
        }

        env.storage().instance().set(&FEE_BPS, &new_fee_bps);

        log!(&env, "Updated fee to {} basis points", new_fee_bps);

        // Extend TTL when owner interacts with contract
        Self::extend_ttl_if_needed(&env);

        Ok(())
    }

    /// Upgrade the contract's WASM to a new hash.
    /// Only callable by the owner, and only while updates are still enabled.
    pub fn update_contract(
        env: Env,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();

        let updates_enabled: bool = env.storage().instance().get(&UPDATES_ENABLED).unwrap();
        if !updates_enabled {
            return Err(ContractError::UpdatesDisabled);
        }

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash);

        Self::extend_ttl_if_needed(&env);

        Ok(())
    }

    /// Permanently disable any further contract WASM upgrades.
    /// Only callable by the owner. This action is irreversible.
    pub fn disable_updates(env: Env) -> Result<(), ContractError> {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();

        env.storage().instance().set(&UPDATES_ENABLED, &false);

        log!(&env, "Contract updates permanently disabled");

        Self::extend_ttl_if_needed(&env);

        Ok(())
    }

    /// Whether contract WASM upgrades are still permitted (view function).
    pub fn updates_enabled(env: Env) -> bool {
        env.storage().instance().get(&UPDATES_ENABLED).unwrap()
    }

    /// Get current configuration (view function)
    pub fn get_config(env: Env) -> (Address, Address, Address, Address, u32) {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        let xlm_address: Address = env.storage().instance().get(&XLMADDRESS).unwrap();
        let usdc_address: Address = env.storage().instance().get(&USDCADDRESS).unwrap();
        let eurc_address: Address = env.storage().instance().get(&EURCADDRESS).unwrap();
        let fee_bps: u32 = env.storage().instance().get(&FEE_BPS).unwrap_or(100);

        (owner, xlm_address, usdc_address, eurc_address, fee_bps)
    }

    // Helper function to decode base64 to 32 bytes
    fn decode_base64_to_bytes32(env: &Env, input: &str) -> Result<BytesN<32>, ContractError> {
        let mut decoded = [0u8; 32];
        log!(env, "Decoding base64: {}", input);

        // Decode the input into the buffer
        let decoded_len = general_purpose::STANDARD
            .decode_slice(input, &mut decoded)
            .map_err(|_| ContractError::InvalidBase64)?;

        // Check if the decoded length is exactly 32 bytes
        if decoded_len != 32 {
            return Err(ContractError::InvalidBase64Length);
        }

        Ok(BytesN::from_array(env, &decoded))
    }

    // Helper function to calculate service fee using basis points
    fn calculate_service_fee(env: &Env, price: u64) -> Result<u64, ContractError> {
        let fee_bps: u32 = env.storage().instance().get(&FEE_BPS).unwrap_or(100);

        // Calculate fee: (price * fee_bps) / 10000
        // Using checked arithmetic to prevent overflow
        let fee = price
            .checked_mul(fee_bps as u64)
            .ok_or(ContractError::PriceOverflow)?
            .checked_div(10000)
            .ok_or(ContractError::PriceOverflow)?;

        Ok(fee)
    }

    // Helper function to extend TTL only when needed
    fn extend_ttl_if_needed(env: &Env) {
        // Only extend if TTL is below threshold
        // This is more efficient than always extending to max
        env.storage()
            .instance()
            .extend_ttl(CONFIG_TTL_THRESHOLD, CONFIG_TTL_EXTEND);

        // Note: We don't need to extend the contract code TTL separately
        // as it's handled by the instance storage
    }
}

mod test;
