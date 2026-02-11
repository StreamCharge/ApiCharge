/**
 * x402 apicharge scheme client — reference implementation.
 *
 * Demonstrates the full x402 flow for the 'apicharge' scheme:
 * 1. Request a protected resource via /x402/{pubkey}/...
 * 2. Receive 402 with PAYMENT-REQUIRED header
 * 3. Sign the authorisationToSign hash with Ed25519
 * 4. Retry with PAYMENT-SIGNATURE header
 * 5. Receive 200 with PAYMENT-RESPONSE header + proxied response
 * 6. Use AccessToken cookie for subsequent requests
 *
 * Zero Stellar SDK required — only Ed25519 signing and HTTP.
 */

import { type StellarKeyPair, sign } from "./stellar-keys.js";

// x402 v2 types (matching the server DTOs)

export interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: X402ApiChargeExtra;
}

export interface X402ApiChargeExtra {
  authorisationToSign: string; // base64
  purchaseInstructionSignature: string; // base64
  stellarTransaction: string; // base64 XDR
}

export interface X402PaymentPayload {
  x402Version: number;
  resource?: { url: string; description?: string; mimeType?: string };
  accepted: X402PaymentRequirements;
  payload: X402ApiChargePayload;
  extensions?: Record<string, unknown>;
}

export interface X402ApiChargePayload {
  signature: string; // base64 Ed25519 signature
  publicKey: string; // G-address
}

export interface X402SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  extensions?: Record<string, unknown>;
}

export interface X402FlowResult {
  /** The proxied response from the upstream service */
  response: Response;
  /** Parsed PAYMENT-RESPONSE header */
  settlement: X402SettlementResponse;
  /** The URL-encoded AccessToken for subsequent requests */
  accessToken: string;
}

/**
 * Execute the full x402 apicharge payment flow against a protected endpoint.
 *
 * @param baseUrl - Server base URL (e.g., "https://localhost:443")
 * @param path - Resource path WITHOUT leading /x402/{pubkey}/ (e.g., "/AudioStream/test")
 * @param keypair - Stellar keypair for signing
 * @param fetchOptions - Additional fetch options (headers, method, etc.)
 */
export async function x402Fetch(
  baseUrl: string,
  path: string,
  keypair: StellarKeyPair,
  fetchOptions?: RequestInit
): Promise<X402FlowResult> {
  // Step 1: Request via x402 URL prefix
  const x402Url = `${baseUrl}/x402/${keypair.address}${path}`;

  console.log(`[x402] Step 1: Requesting ${x402Url}`);
  let initialResponse: Response;
  try {
    initialResponse = await fetch(x402Url, {
      ...fetchOptions,
      redirect: "manual",
    });
  } catch (err) {
    console.error(`[x402] Network error:`, err);
    throw new Error(`Network request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (initialResponse.status !== 402) {
    throw new Error(
      `Expected 402 Payment Required, got ${initialResponse.status}`
    );
  }

  // Step 2: Parse PAYMENT-REQUIRED header
  const paymentRequiredHeader = initialResponse.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error("Missing PAYMENT-REQUIRED header in 402 response");
  }

  const paymentRequired: X402PaymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")
  );

  console.log(`[x402] Step 2: Received 402 with ${paymentRequired.accepts.length} payment option(s)`);

  // Find the apicharge scheme
  const accepted = paymentRequired.accepts.find((a) => a.scheme === "apicharge");
  if (!accepted) {
    throw new Error(
      `No 'apicharge' scheme in payment options. Available: ${paymentRequired.accepts.map((a) => a.scheme).join(", ")}`
    );
  }

  if (!accepted.extra) {
    throw new Error("Missing 'extra' field in apicharge payment requirements");
  }

  console.log(
    `[x402]   Scheme: ${accepted.scheme}, Network: ${accepted.network}, Amount: ${accepted.amount} ${accepted.asset}`
  );

  // Step 3: Sign the authorisationToSign hash
  const authorisationBytes = Buffer.from(
    accepted.extra.authorisationToSign,
    "base64"
  );
  const signature = sign(authorisationBytes, keypair.secretKey);
  const signatureBase64 = Buffer.from(signature).toString("base64");

  console.log(`[x402] Step 3: Signed authorisation hash (${authorisationBytes.length} bytes)`);

  // Step 4: Build PAYMENT-SIGNATURE payload and retry
  const paymentPayload: X402PaymentPayload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: accepted,
    payload: {
      signature: signatureBase64,
      publicKey: keypair.address,
    },
  };

  const paymentSignatureHeader = Buffer.from(
    JSON.stringify(paymentPayload)
  ).toString("base64");

  console.log(`[x402] Step 4: Retrying with PAYMENT-SIGNATURE header`);
  let settledResponse: Response;
  try {
    settledResponse = await fetch(x402Url, {
      ...fetchOptions,
      headers: {
        ...((fetchOptions?.headers as Record<string, string>) ?? {}),
        "PAYMENT-SIGNATURE": paymentSignatureHeader,
      },
      redirect: "manual",
    });
  } catch (err) {
    console.error(`[x402] Network error on settlement:`, err);
    throw new Error(`Settlement request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (settledResponse.status === 402) {
    const body = await settledResponse.text();
    throw new Error(`Settlement failed with 402: ${body}`);
  }

  if (settledResponse.status >= 400) {
    const body = await settledResponse.text();
    throw new Error(
      `Settlement failed with ${settledResponse.status}: ${body}`
    );
  }

  // Step 5: Parse PAYMENT-RESPONSE header
  const paymentResponseHeader = settledResponse.headers.get("payment-response");
  if (!paymentResponseHeader) {
    throw new Error("Missing PAYMENT-RESPONSE header in settled response");
  }

  const settlement: X402SettlementResponse = JSON.parse(
    Buffer.from(paymentResponseHeader, "base64").toString("utf-8")
  );

  console.log(`[x402] Step 5: Settlement ${settlement.success ? "succeeded" : "failed"}`);
  console.log(`[x402]   Transaction: ${settlement.transaction}`);
  console.log(`[x402]   Network: ${settlement.network}`);

  // Extract AccessToken from extensions or Set-Cookie
  const accessToken =
    (settlement.extensions?.accessToken as string) ??
    extractAccessTokenFromCookie(settledResponse);

  if (!accessToken) {
    console.warn("[x402] Warning: No AccessToken found in response");
  } else {
    console.log(`[x402]   AccessToken received (${accessToken.length} chars)`);
  }

  return {
    response: settledResponse,
    settlement,
    accessToken,
  };
}

/**
 * Sign an AccessToken for subsequent use.
 * The client signs the server's inner signature to prove receipt.
 */
export function signAccessToken(
  accessTokenUrlEncoded: string,
  keypair: StellarKeyPair
): string {
  // URL-decode and parse the token
  const tokenJson = decodeURIComponent(accessTokenUrlEncoded);
  const token = JSON.parse(tokenJson);

  // Extract the server's inner signature (signableEntity.signature)
  const serverSignatureBase64 = token.signableEntity?.signature;
  if (!serverSignatureBase64) {
    throw new Error("AccessToken missing signableEntity.signature");
  }

  // Sign the server's signature with the client's key
  const serverSignatureBytes = Buffer.from(serverSignatureBase64, "base64");
  const clientSignature = sign(serverSignatureBytes, keypair.secretKey);

  // Set the outer signature and signingPubkey
  token.signature = Buffer.from(clientSignature).toString("base64");
  token.signingPubkey = Buffer.from(keypair.publicKey).toString("base64");

  // Re-serialize and URL-encode
  return encodeURIComponent(JSON.stringify(token));
}

/**
 * Make a subsequent request using a previously obtained AccessToken.
 * The token must be signed first using signAccessToken().
 */
export async function authenticatedFetch(
  url: string,
  accessToken: string,
  fetchOptions?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...fetchOptions,
    headers: {
      ...((fetchOptions?.headers as Record<string, string>) ?? {}),
      apicharge: accessToken,
    },
  });
}

function extractAccessTokenFromCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/apicharge=([^;]+)/);
  return match?.[1] ?? "";
}
