/**
 * x402 apicharge scheme — end-to-end test against ApiChargePrototype.
 *
 * Prerequisites:
 *   1. ServerTestApp running (the upstream AudioStream backend)
 *   2. ApiChargePrototype running (the monetising reverse proxy with x402 support)
 *
 * Usage:
 *   npx tsx src/index.ts [baseUrl] [secretSeed]
 *
 * Examples:
 *   npx tsx src/index.ts                                          # uses defaults
 *   npx tsx src/index.ts https://localhost:443                     # custom server
 *   npx tsx src/index.ts https://localhost:443 SXXXXXXX...        # custom server + key
 */

// Allow self-signed certificates in development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { keypairFromSecret, generateKeypair } from "./stellar-keys.js";
import { x402Fetch, authenticatedFetch, signAccessToken } from "./x402-client.js";

const BASE_URL = process.argv[2] || "https://localhost:443";
const SECRET_SEED = process.argv[3]; // optional — generates random keypair if not provided

async function main() {
  console.log("=== x402 apicharge scheme — end-to-end test ===\n");

  // Step 0: Set up keypair
  const keypair = SECRET_SEED
    ? keypairFromSecret(SECRET_SEED)
    : generateKeypair();

  console.log(`Keypair: ${keypair.address}`);
  if (!SECRET_SEED) {
    console.log(
      "(Generated random keypair — settlement will fail without funded testnet account)"
    );
    console.log(
      "To use a funded account, pass your secret seed as the second argument\n"
    );
  }

  // Step 1-5: Execute x402 payment flow against AudioStream route
  console.log("\n--- Phase 1: x402 Payment Flow ---\n");
  try {
    const result = await x402Fetch(
      BASE_URL,
      "/AudioStream/stream/audiodemo_short",
      keypair
    );

    console.log(`\nSettlement result: ${JSON.stringify(result.settlement, null, 2)}`);
    console.log(`Response status: ${result.response.status}`);

    // Try to read some of the response body
    const responseText = await result.response.text();
    console.log(
      `Response body (first 200 chars): ${responseText.slice(0, 200)}`
    );

    // Step 6: Make a subsequent authenticated request
    if (result.accessToken) {
      console.log("\n--- Phase 2: Authenticated Request (using AccessToken) ---\n");

      // Sign the AccessToken before use (client counter-signs server's signature)
      console.log("[auth] Signing AccessToken with client key...");
      const signedToken = signAccessToken(result.accessToken, keypair);
      console.log(`[auth] Signed token (${signedToken.length} chars)`);

      const authResponse = await authenticatedFetch(
        `${BASE_URL}/AudioStream/stream/audiodemo_short`,
        signedToken
      );

      console.log(`Authenticated response status: ${authResponse.status}`);
      const authBody = await authResponse.text();
      console.log(
        `Authenticated response body (first 200 chars): ${authBody.slice(0, 200)}`
      );
    }

    console.log("\n=== Test completed successfully ===");
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\nTest failed: ${error.message}`);

      // If settlement fails (expected with unfunded account), that's OK —
      // the 402 negotiation phase still validates the protocol flow
      if (
        error.message.includes("Settlement failed") ||
        error.message.includes("Blockchain transaction failed")
      ) {
        console.log(
          "\nNote: Settlement failure is expected if using an unfunded account."
        );
        console.log(
          "The x402 negotiation (402 + PAYMENT-REQUIRED) was still validated."
        );
        console.log(
          "To complete a full purchase, use a funded Stellar testnet account."
        );
      }
    } else {
      console.error("\nUnexpected error:", error);
    }
    if (error instanceof Error && error.cause) {
      console.error("Cause:", error.cause);
    }
    process.exit(1);
  }
}

main();
