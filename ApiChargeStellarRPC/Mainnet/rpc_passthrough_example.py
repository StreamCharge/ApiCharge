#!/usr/bin/env python3
"""
ApiCharge RPC Passthrough Example
=================================

This script demonstrates how to make standard Stellar JSON-RPC calls
via the ApiCharge passthrough route. No fee sponsorship - just direct RPC access.

Requirements:
    pip install stellar-sdk requests

Usage:
    python rpc_passthrough_example.py --secret YOUR_SECRET_KEY

Replace YOUR_SECRET_KEY with your Stellar secret key (starts with 'S').
The account must have USDC balance for token purchase.
"""

import argparse
import base64
import json
import urllib.parse
import requests
from stellar_sdk import Keypair

# =============================================================================
# CONFIGURATION
# =============================================================================

# ApiCharge server URL
SERVER_URL = "https://mainnet.stellar.apicharge.com"
# RPC path (production path)
DEFAULT_RPC_PATH = "/soroban/"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_quotes(server_url: str) -> dict:
    """Fetch available route quotes from the server."""
    response = requests.get(f"{server_url}/apicharge/quote", verify=True, timeout=30)
    response.raise_for_status()
    return response.json()


def find_quote_by_route_id(quotes: dict, route_id_substring: str) -> dict | None:
    """Find a quote by partial route ID match."""
    for quote in quotes.get("quotes", []):
        signable = quote.get("signableEntity", {})
        if route_id_substring in signable.get("routeId", ""):
            return quote
    return None


def purchase_access_token(server_url: str, route_quote: dict, keypair: Keypair) -> str:
    """
    Complete the 4-step nanosubscription purchase flow:
    1. Request purchase instruction
    2. Sign the authorization
    3. Submit purchase
    4. Sign the access token
    """
    print("  Step 1: Requesting purchase instruction...")

    purchase_request = {
        "clientPublicKey": keypair.public_key,
        "routeQuote": route_quote
    }

    response = requests.post(
        f"{server_url}/apicharge/nanosubscription/PurchaseInstruction",
        json=purchase_request, verify=True, timeout=60
    )
    if not response.ok:
        print(f"  ERROR: {response.status_code} - {response.text}")
        response.raise_for_status()

    purchase_instruction = response.json()

    print("  Step 2: Signing authorization...")
    auth_to_sign = purchase_instruction.get("authorisationToSign", "")
    auth_bytes = bytes.fromhex(auth_to_sign) if not _is_base64(auth_to_sign) else base64.b64decode(auth_to_sign)
    signed_auth = keypair.sign(auth_bytes)
    purchase_instruction["authorisationToSign"] = base64.b64encode(signed_auth).decode('utf-8')

    print("  Step 3: Purchasing access token...")
    response = requests.post(
        f"{server_url}/apicharge/nanosubscription/Purchase",
        json=purchase_instruction, verify=True, timeout=60
    )
    if not response.ok:
        print(f"  ERROR: {response.status_code} - {response.text}")
        response.raise_for_status()

    access_token = response.json()

    print("  Step 4: Signing access token...")
    signable_entity = access_token.get("signableEntity", {})
    signature_to_sign = signable_entity.get("signature", "")

    if signature_to_sign:
        sig_bytes = base64.b64decode(signature_to_sign)
        token_signature = keypair.sign(sig_bytes)
        access_token["signature"] = base64.b64encode(token_signature).decode('utf-8')

    token_json = json.dumps(access_token, separators=(',', ':'))
    return urllib.parse.quote(token_json, safe='')


def _is_base64(s: str) -> bool:
    try:
        base64.b64decode(s)
        return True
    except:
        return False


# =============================================================================
# MAIN SCRIPT
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='ApiCharge RPC Passthrough Example')
    parser.add_argument('--secret', '-s', required=True, help='Your Stellar secret key (starts with S)')
    parser.add_argument('--server', default=SERVER_URL, help='ApiCharge server URL')
    parser.add_argument('--path', default=DEFAULT_RPC_PATH, help='RPC path (default: /soroban/)')
    args = parser.parse_args()

    print("=" * 60)
    print("ApiCharge RPC Passthrough Example")
    print("=" * 60)
    print()

    try:
        keypair = Keypair.from_secret(args.secret)
    except Exception as e:
        print(f"ERROR: Invalid secret key: {e}")
        return

    print(f"Account: {keypair.public_key}")
    print(f"Server:  {args.server}")
    print(f"RPC Path: {args.path}")
    print()

    try:
        # Step 1: Fetch quotes
        print("[1/3] Fetching available quotes...")
        quotes = get_quotes(args.server)

        rpc_quote = find_quote_by_route_id(quotes, "stellar-rpc-developer")
        if not rpc_quote:
            print("ERROR: stellar-rpc-developer route not found")
            return

        price = rpc_quote["signableEntity"]["microUnitPrice"] / 1_000_000
        print(f"       RPC route price: ${price:.4f} USDC per call")
        print()

        # Step 2: Purchase access token
        print("[2/3] Purchasing RPC access token...")
        token = purchase_access_token(args.server, rpc_quote, keypair)
        print("       Access token acquired!")
        print()

        # Step 3: Make RPC calls
        print("[3/3] Making RPC calls via passthrough...")
        print()

        # Example 1: getHealth
        print("  >> getHealth")
        response = requests.post(
            f"{args.server}{args.path}",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "getHealth"},
            timeout=30
        )
        result = response.json()
        print(f"     Status: {result.get('result', {}).get('status', 'unknown')}")
        print()

        # Example 2: getLatestLedger
        print("  >> getLatestLedger")
        response = requests.post(
            f"{args.server}{args.path}",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={"jsonrpc": "2.0", "id": 2, "method": "getLatestLedger"},
            timeout=30
        )
        result = response.json()
        ledger = result.get('result', {})
        print(f"     Sequence: {ledger.get('sequence', 'unknown')}")
        print(f"     Hash: {ledger.get('hash', 'unknown')[:16]}...")
        print()

        # Example 3: getNetwork
        print("  >> getNetwork")
        response = requests.post(
            f"{args.server}{args.path}",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={"jsonrpc": "2.0", "id": 3, "method": "getNetwork"},
            timeout=30
        )
        result = response.json()
        network = result.get('result', {})
        print(f"     Passphrase: {network.get('passphrase', 'unknown')[:30]}...")
        print()

        print("=" * 60)
        print("SUCCESS! RPC passthrough working correctly")
        print("=" * 60)

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Network error: {e}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
