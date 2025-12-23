#!/usr/bin/env node
/**
 * ApiCharge Full Account Activation Example
 * =========================================
 *
 * This script demonstrates how to fully activate a new Stellar account with
 * USDC and EURC trustlines using the 2-phase activation flow:
 *
 * Phase 1: Server creates account with XLM base reserve
 * Phase 2: Client signs trustline transaction, server fee-bumps and submits
 *
 * Requirements:
 *     npm install @stellar/stellar-sdk
 *
 * Usage:
 *     node activate_account_full_example.js --secret YOUR_SECRET_KEY
 */

const { Keypair } = require('@stellar/stellar-sdk');

// =============================================================================
// CONFIGURATION
// =============================================================================

const SERVER_URL = 'https://mainnet.stellar.apicharge.com';

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
    const secretKey = secretIndex >= 0 ? args[secretIndex + 1] : args.find(a => a.startsWith('S'));
    const useTestnet = args.includes('--testnet');

    if (!secretKey) {
        console.log('Usage: node activate_account_full_example.js --secret YOUR_SECRET_KEY');
        console.log('       Your secret key should start with "S"');
        console.log('       Add --testnet for testnet');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('ApiCharge Full Account Activation Example (JavaScript)');
    console.log('(Phase 1 + Phase 2 - XLM reserve + USDC/EURC trustlines)');
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
    console.log(`Network:     ${useTestnet ? 'Testnet' : 'Mainnet'}`);
    console.log();

    // IMPORTANT: Save the new account's secret key!
    console.log('='.repeat(60));
    console.log('SAVE THIS SECRET KEY - You will need it to use the account!');
    console.log(`Secret: ${newAccount.secret()}`);
    console.log('='.repeat(60));
    console.log();

    try {
        // Step 1: Fetch quotes
        console.log('[1/5] Fetching available quotes...');
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
        console.log('[2/5] Purchasing activation access token...');
        const token = await purchaseAccessToken(SERVER_URL, activateQuote, payerKeypair);
        console.log('       Access token acquired!');
        console.log();

        // Step 3: Phase 1 - Create account
        console.log('[3/5] Phase 1: Creating account...');
        let response = await fetch(`${SERVER_URL}/apicharge/stablecoin/activate-account`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: newAccount.publicKey() })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log(`ERROR: Phase 1 failed: ${response.status}`);
            console.log(`       ${error}`);
            process.exit(1);
        }

        const phase1Result = await response.json();
        console.log(`       Status: ${phase1Result.status || 'unknown'}`);
        console.log(`       TX Hash: ${phase1Result.transactionHash || 'unknown'}`);
        console.log();

        // Check if Phase 2 data is available
        const ticket = phase1Result.ticket;
        const trustlineXdr = phase1Result.trustlineTransactionXdr;
        const trustlineHash = phase1Result.trustlineTransactionHash;

        if (!ticket || !trustlineXdr) {
            console.log('WARNING: Phase 2 data not returned');
            console.log('         Account created but trustlines not available');
            console.log('         This may indicate the account already had trustlines');
            process.exit(0);
        }

        console.log(`       Trustline TX Hash: ${trustlineHash}`);
        console.log(`       Ticket received: ${ticket.substring(0, 50)}...`);
        console.log();

        // Step 4: Sign trustline transaction HASH with NEW account's key
        // Using Option B: RawSignature - simpler than parsing XDR
        console.log('[4/5] Phase 2: Signing trustline transaction hash...');
        console.log(`       Signing with new account: ${newAccount.publicKey()}`);

        // Sign the transaction hash directly (64-byte Ed25519 signature)
        const hashBytes = Buffer.from(trustlineHash, 'hex');
        const rawSignature = newAccount.sign(hashBytes);
        const rawSignatureBase64 = rawSignature.toString('base64');

        console.log('       Transaction hash signed!');
        console.log();

        // Step 5: Submit Phase 2 with raw signature (server wraps into envelope)
        console.log('[5/5] Phase 2: Submitting signed trustline transaction...');
        response = await fetch(`${SERVER_URL}/apicharge/stablecoin/activate-account`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                publicKey: newAccount.publicKey(),
                ticket: ticket,
                callerAccount: newAccount.publicKey(),
                rawSignature: rawSignatureBase64
            })
        });

        if (response.ok) {
            console.log();
            console.log('='.repeat(60));
            console.log('SUCCESS! Account fully activated with trustlines!');
            console.log('='.repeat(60));
            console.log(`Account: ${newAccount.publicKey()}`);
            console.log();
            console.log('The account now has:');
            console.log('  - XLM base reserve');
            console.log('  - USDC trustline (ready to receive USDC)');
            console.log('  - EURC trustline (ready to receive EURC)');
            console.log();
            console.log(`View on Stellar Expert:`);
            console.log(`https://stellar.expert/explorer/public/account/${newAccount.publicKey()}`);
        } else {
            const error = await response.text();
            console.log(`ERROR: Phase 2 failed: ${response.status}`);
            console.log(`       ${error}`);
            console.log();
            console.log('Note: Phase 1 succeeded - account exists with XLM');
            console.log('      Trustlines may need to be added manually');
        }

    } catch (e) {
        console.log(`ERROR: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

main();
