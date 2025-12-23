#!/usr/bin/env node
/**
 * ApiCharge Basic Account Activation Example
 * ==========================================
 *
 * This script demonstrates how to activate a new Stellar account using
 * the ApiCharge stablecoin-native endpoint. This is Phase 1 only -
 * creates the account with XLM but does NOT establish trustlines.
 *
 * Requirements:
 *     npm install @stellar/stellar-sdk
 *
 * Usage:
 *     node activate_account_basic_example.js --secret YOUR_SECRET_KEY
 */

const { Keypair } = require('@stellar/stellar-sdk');

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_SERVER_URL = 'https://mainnet.stellar.apicharge.com';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function getQuotes(serverUrl) {
    const response = await fetch(`${serverUrl}/apicharge/quote`);
    if (!response.ok) throw new Error(`Failed to fetch quotes: ${response.status}`);
    return response.json();
}

function findQuoteByRouteId(quotes, routeIdSubstring) {
    return quotes.quotes?.find(q =>
        q.signableEntity?.routeId?.includes(routeIdSubstring)
    );
}

async function purchaseAccessToken(serverUrl, routeQuote, keypair) {
    console.log('  Step 1: Requesting purchase instruction...');

    const purchaseRequest = {
        clientPublicKey: keypair.publicKey(),
        routeQuote: routeQuote
    };

    let response = await fetch(`${serverUrl}/apicharge/nanosubscription/PurchaseInstruction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseRequest)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Purchase instruction failed: ${response.status} - ${error}`);
    }

    const purchaseInstruction = await response.json();

    console.log('  Step 2: Signing authorization...');
    const authToSign = purchaseInstruction.authorisationToSign;
    const authBytes = isBase64(authToSign)
        ? Buffer.from(authToSign, 'base64')
        : Buffer.from(authToSign, 'hex');
    const signedAuth = keypair.sign(authBytes);
    purchaseInstruction.authorisationToSign = signedAuth.toString('base64');

    console.log('  Step 3: Purchasing access token...');
    response = await fetch(`${serverUrl}/apicharge/nanosubscription/Purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseInstruction)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Purchase failed: ${response.status} - ${error}`);
    }

    const accessToken = await response.json();

    console.log('  Step 4: Signing access token...');
    const signatureToSign = accessToken.signableEntity?.signature;
    if (signatureToSign) {
        const sigBytes = Buffer.from(signatureToSign, 'base64');
        const tokenSignature = keypair.sign(sigBytes);
        accessToken.signature = tokenSignature.toString('base64');
    }

    return encodeURIComponent(JSON.stringify(accessToken));
}

function isBase64(str) {
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
        return false;
    }
}

// =============================================================================
// MAIN SCRIPT
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    const secretIndex = args.indexOf('--secret');
    const serverIndex = args.indexOf('--server');
    const secretKey = secretIndex >= 0 ? args[secretIndex + 1] : args.find(a => a.startsWith('S'));
    const SERVER_URL = serverIndex >= 0 ? args[serverIndex + 1] : DEFAULT_SERVER_URL;

    if (!secretKey) {
        console.log('Usage: node activate_account_basic_example.js --secret YOUR_SECRET_KEY [--server URL]');
        console.log('       Your secret key should start with "S"');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('ApiCharge Basic Account Activation Example (JavaScript)');
    console.log('(Phase 1 Only - XLM reserve, NO trustlines)');
    console.log('='.repeat(60));
    console.log();

    let payerKeypair;
    try {
        payerKeypair = Keypair.fromSecret(secretKey);
    } catch (e) {
        console.log(`ERROR: Invalid payer secret key: ${e.message}`);
        process.exit(1);
    }

    // Generate new account
    const newAccount = Keypair.random();

    console.log(`Payer:       ${payerKeypair.publicKey()}`);
    console.log(`New Account: ${newAccount.publicKey()}`);
    console.log(`Server:      ${SERVER_URL}`);
    console.log();

    // IMPORTANT: Save the new account's secret key!
    console.log('='.repeat(60));
    console.log('SAVE THIS SECRET KEY - You will need it to use the account!');
    console.log(`Secret: ${newAccount.secret()}`);
    console.log('='.repeat(60));
    console.log();

    try {
        // Step 1: Fetch quotes
        console.log('[1/3] Fetching available quotes...');
        const quotes = await getQuotes(SERVER_URL);

        const activateQuote = findQuoteByRouteId(quotes, 'stablecoin-activate-account');
        if (!activateQuote) {
            console.log('ERROR: stablecoin-activate-account route not found');
            process.exit(1);
        }

        const price = activateQuote.signableEntity.microUnitPrice / 1_000_000;
        console.log(`       Activation price: $${price.toFixed(4)} USDC`);
        console.log();

        // Step 2: Purchase access token
        console.log('[2/3] Purchasing activation access token...');
        const token = await purchaseAccessToken(SERVER_URL, activateQuote, payerKeypair);
        console.log('       Access token acquired!');
        console.log();

        // Step 3: Activate account (Phase 1 only)
        console.log('[3/3] Activating account (Phase 1)...');
        const response = await fetch(`${SERVER_URL}/apicharge/stablecoin/activate-account`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: newAccount.publicKey() })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log(`ERROR: Activation failed: ${response.status}`);
            console.log(`       ${error}`);
            process.exit(1);
        }

        const result = await response.json();

        console.log();
        console.log('='.repeat(60));
        console.log('SUCCESS! Account activated (Phase 1 complete)');
        console.log('='.repeat(60));
        console.log(`Status:     ${result.status || 'unknown'}`);
        console.log(`Account ID: ${result.accountId || 'unknown'}`);
        console.log(`TX Hash:    ${result.transactionHash || 'unknown'}`);
        console.log();
        console.log('The account now exists with XLM base reserve.');
        console.log('NOTE: Trustlines are NOT established.');
        console.log('      To receive USDC/EURC, use activate_account_full_example.js');
        console.log();
        console.log(`View on Stellar Expert:`);
        console.log(`https://stellar.expert/explorer/public/account/${newAccount.publicKey()}`);

    } catch (e) {
        console.log(`ERROR: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

main();
