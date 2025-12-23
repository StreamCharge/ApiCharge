#!/usr/bin/env node
/**
 * ApiCharge Stablecoin-Native Example Script (JavaScript)
 * =======================================================
 *
 * This script demonstrates how to send a fee-sponsored USDC payment using
 * the ApiCharge Stablecoin-Native endpoints on mainnet.
 *
 * Requirements:
 *     npm install @stellar/stellar-sdk
 *
 * Usage:
 *     node stablecoin_example.js --secret YOUR_SECRET_KEY --recipient GXXXX... --amount 1.00
 *
 * Replace YOUR_SECRET_KEY with your Stellar secret key (starts with 'S').
 * The account must have USDC balance and a USDC trustline.
 */

const {
    Keypair,
    Networks,
    TransactionBuilder,
    Asset,
    Account,
    Operation
} = require('@stellar/stellar-sdk');

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_SERVER_URL = 'https://mainnet.stellar.apicharge.com';
const HORIZON_URL = 'https://horizon.stellar.org';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

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

async function getAccountSequence(publicKey) {
    const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!response.ok) throw new Error(`Failed to fetch account: ${response.status}`);
    const account = await response.json();
    return account.sequence;
}

function isBase64(str) {
    try {
        return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
        return false;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// MAIN SCRIPT
// =============================================================================

async function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    const secretIndex = args.indexOf('--secret');
    const recipientIndex = args.indexOf('--recipient');
    const amountIndex = args.indexOf('--amount');
    const serverIndex = args.indexOf('--server');

    const secretKey = secretIndex >= 0 ? args[secretIndex + 1] : null;
    const recipient = recipientIndex >= 0 ? args[recipientIndex + 1] : null;
    const amount = amountIndex >= 0 ? args[amountIndex + 1] : '0.0001';
    const SERVER_URL = serverIndex >= 0 ? args[serverIndex + 1] : DEFAULT_SERVER_URL;

    if (!secretKey) {
        console.log('Usage: node stablecoin_example.js --secret YOUR_SECRET_KEY --recipient GXXXX... --amount 1.00 [--server URL]');
        console.log('');
        console.log('Arguments:');
        console.log('  --secret     Your Stellar secret key (starts with S)');
        console.log('  --recipient  Recipient public key (starts with G)');
        console.log('  --amount     Amount to send in USDC (default: 0.0001)');
        console.log('  --server     ApiCharge server URL (optional)');
        process.exit(1);
    }

    if (!recipient) {
        console.log('ERROR: --recipient is required');
        console.log('       Provide a Stellar public key starting with G');
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('ApiCharge Stablecoin-Native Payment Example (JavaScript)');
    console.log('='.repeat(60));
    console.log();

    let senderKeypair;
    try {
        senderKeypair = Keypair.fromSecret(secretKey);
    } catch (e) {
        console.log(`ERROR: Invalid secret key: ${e.message}`);
        process.exit(1);
    }

    console.log(`Sender:    ${senderKeypair.publicKey()}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Amount:    ${amount} USDC`);
    console.log(`Server:    ${SERVER_URL}`);
    console.log();

    try {
        // Step 1: Fetch quotes
        console.log('[1/6] Fetching available quotes...');
        const quotes = await getQuotes(SERVER_URL);

        const submitQuote = findQuoteByRouteId(quotes, 'stablecoin-submit-classic-tx');
        const statusQuote = findQuoteByRouteId(quotes, 'stablecoin-get-tx-status');

        if (!submitQuote) {
            console.log('ERROR: stablecoin-submit-classic-tx route not found');
            process.exit(1);
        }

        if (!statusQuote) {
            console.log('ERROR: stablecoin-get-tx-status route not found');
            process.exit(1);
        }

        const submitPrice = submitQuote.signableEntity.microUnitPrice / 1_000_000;
        const statusPrice = statusQuote.signableEntity.microUnitPrice / 1_000_000;

        console.log(`       Submit route: $${submitPrice.toFixed(2)} USDC`);
        console.log(`       Status route: $${statusPrice.toFixed(2)} USDC`);
        console.log(`       Total cost:   $${(submitPrice + statusPrice).toFixed(2)} USDC`);
        console.log();

        // Step 2: Purchase submit access token
        console.log('[2/6] Purchasing submit access token...');
        const submitToken = await purchaseAccessToken(SERVER_URL, submitQuote, senderKeypair);
        console.log('       Access token acquired!');
        console.log();

        // Step 3: Purchase status access token
        console.log('[3/6] Purchasing status access token...');
        const statusToken = await purchaseAccessToken(SERVER_URL, statusQuote, senderKeypair);
        console.log('       Access token acquired!');
        console.log();

        // Step 4: Get account sequence number
        console.log('[4/6] Fetching account sequence number...');
        const sequence = await getAccountSequence(senderKeypair.publicKey());
        console.log(`       Sequence: ${sequence}`);
        console.log();

        // Step 5: Build and submit transaction
        console.log('[5/6] Building zero-fee transaction...');

        const usdc = new Asset('USDC', USDC_ISSUER);
        const account = new Account(senderKeypair.publicKey(), sequence);

        const tx = new TransactionBuilder(account, {
            fee: '0',  // ZERO FEE - ApiCharge will sponsor
            networkPassphrase: Networks.PUBLIC
        })
            .addOperation(Operation.payment({
                destination: recipient,
                asset: usdc,
                amount: amount
            }))
            .setTimeout(300)
            .build();

        tx.sign(senderKeypair);
        const txXdr = tx.toXDR();

        console.log('       Transaction built and signed');
        console.log();

        console.log('       Submitting to ApiCharge...');
        const submitResponse = await fetch(`${SERVER_URL}/apicharge/stablecoin/submit-transaction`, {
            method: 'POST',
            headers: { 'apicharge': submitToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionXdr: txXdr })
        });

        if (!submitResponse.ok) {
            const error = await submitResponse.text();
            console.log(`ERROR: Submit failed: ${submitResponse.status}`);
            console.log(`       ${error}`);
            process.exit(1);
        }

        const submitResult = await submitResponse.json();
        const txHash = submitResult.transactionHash;

        if (!txHash) {
            console.log(`ERROR: Submit failed: ${JSON.stringify(submitResult)}`);
            process.exit(1);
        }

        console.log(`       Transaction hash: ${txHash}`);
        console.log();

        // Step 6: Wait for confirmation
        console.log('[6/6] Waiting for confirmation...');

        for (let attempt = 1; attempt <= 20; attempt++) {
            await sleep(2000);

            const statusResponse = await fetch(`${SERVER_URL}/apicharge/stablecoin/get-transaction-status`, {
                method: 'POST',
                headers: { 'apicharge': statusToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactionHash: txHash })
            });

            const status = await statusResponse.json();
            const statusStr = status.status || 'unknown';
            const ledger = status.ledger || 'pending';

            console.log(`       Attempt ${attempt}/20: status=${statusStr}, ledger=${ledger}`);

            if (statusStr.toLowerCase() === 'success') {
                console.log();
                console.log('='.repeat(60));
                console.log('SUCCESS! Transaction confirmed!');
                console.log('='.repeat(60));
                console.log(`Hash:   ${txHash}`);
                console.log(`Ledger: ${ledger}`);
                console.log(`View:   https://stellar.expert/explorer/public/tx/${txHash}`);
                process.exit(0);
            }

            if (statusStr.toLowerCase() === 'failed') {
                console.log();
                console.log('ERROR: Transaction failed');
                console.log(`Result XDR: ${status.resultXdr || 'N/A'}`);
                process.exit(1);
            }
        }

        console.log();
        console.log('WARNING: Transaction status unknown after 20 attempts');
        console.log(`Check manually: https://stellar.expert/explorer/public/tx/${txHash}`);

    } catch (e) {
        console.log(`ERROR: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

main();
