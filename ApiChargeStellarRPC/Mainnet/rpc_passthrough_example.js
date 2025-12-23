#!/usr/bin/env node
/**
 * ApiCharge RPC Passthrough Example
 * ==================================
 *
 * This script demonstrates how to make standard Stellar JSON-RPC calls
 * via the ApiCharge passthrough route. No fee sponsorship - just direct RPC access.
 *
 * Requirements:
 *     npm install @stellar/stellar-sdk
 *
 * Usage:
 *     node rpc_passthrough_example.js --secret YOUR_SECRET_KEY
 */

const { Keypair } = require('@stellar/stellar-sdk');

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_SERVER_URL = 'https://mainnet.stellar.apicharge.com';
const DEFAULT_RPC_PATH = '/soroban/';  // Production path

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
    const pathIndex = args.indexOf('--path');
    const secretKey = secretIndex >= 0 ? args[secretIndex + 1] : args.find(a => a.startsWith('S'));
    const SERVER_URL = serverIndex >= 0 ? args[serverIndex + 1] : DEFAULT_SERVER_URL;
    const RPC_PATH = pathIndex >= 0 ? args[pathIndex + 1] : DEFAULT_RPC_PATH;

    if (!secretKey) {
        console.log('Usage: node rpc_passthrough_example.js --secret YOUR_SECRET_KEY [--server URL] [--path /soroban/]');
        console.log('       Your secret key should start with "S"');
        console.log('       --path: RPC path (default: /soroban/)');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('ApiCharge RPC Passthrough Example (JavaScript)');
    console.log('='.repeat(60));
    console.log();

    let keypair;
    try {
        keypair = Keypair.fromSecret(secretKey);
    } catch (e) {
        console.log(`ERROR: Invalid secret key: ${e.message}`);
        process.exit(1);
    }

    console.log(`Account: ${keypair.publicKey()}`);
    console.log(`Server:  ${SERVER_URL}`);
    console.log(`RPC Path: ${RPC_PATH}`);
    console.log();

    try {
        // Step 1: Fetch quotes
        console.log('[1/3] Fetching available quotes...');
        const quotes = await getQuotes(SERVER_URL);

        const rpcQuote = findQuoteByRouteId(quotes, 'stellar-rpc-developer');
        if (!rpcQuote) {
            console.log('ERROR: stellar-rpc-developer route not found');
            process.exit(1);
        }

        const price = rpcQuote.signableEntity.microUnitPrice / 1_000_000;
        console.log(`       RPC route price: $${price.toFixed(4)} USDC per call`);
        console.log();

        // Step 2: Purchase access token
        console.log('[2/3] Purchasing RPC access token...');
        const token = await purchaseAccessToken(SERVER_URL, rpcQuote, keypair);
        console.log('       Access token acquired!');
        console.log();

        // Step 3: Make RPC calls
        console.log('[3/3] Making RPC calls via passthrough...');
        console.log();

        // Example 1: getHealth
        console.log('  >> getHealth');
        let response = await fetch(`${SERVER_URL}${RPC_PATH}`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
        });
        let result = await response.json();
        console.log(`     Status: ${result.result?.status || 'unknown'}`);
        console.log();

        // Example 2: getLatestLedger
        console.log('  >> getLatestLedger');
        response = await fetch(`${SERVER_URL}${RPC_PATH}`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getLatestLedger' })
        });
        result = await response.json();
        console.log(`     Sequence: ${result.result?.sequence || 'unknown'}`);
        console.log(`     Hash: ${(result.result?.hash || 'unknown').substring(0, 16)}...`);
        console.log();

        // Example 3: getNetwork
        console.log('  >> getNetwork');
        response = await fetch(`${SERVER_URL}${RPC_PATH}`, {
            method: 'POST',
            headers: { 'apicharge': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'getNetwork' })
        });
        result = await response.json();
        console.log(`     Passphrase: ${(result.result?.passphrase || 'unknown').substring(0, 30)}...`);
        console.log();

        console.log('='.repeat(60));
        console.log('SUCCESS! RPC passthrough working correctly');
        console.log('='.repeat(60));

    } catch (e) {
        console.log(`ERROR: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

main();
