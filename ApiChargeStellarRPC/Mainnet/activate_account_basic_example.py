#!/usr/bin/env python3
"""
ApiCharge Basic Account Activation Example
==========================================

This script demonstrates how to activate a new Stellar account using
the ApiCharge stablecoin-native endpoint. This is Phase 1 only -
creates the account with XLM but does NOT establish trustlines.

Use this when you only need an account without USDC/EURC trustlines.
For full activation with trustlines, see activate_account_full_example.py

Requirements:
    pip install stellar-sdk requests

Usage:
    python activate_account_basic_example.py --secret YOUR_SECRET_KEY

The payer account must have USDC balance for the activation fee.
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

SERVER_URL = "https://mainnet.stellar.apicharge.com"

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
    """Complete the 4-step nanosubscription purchase flow."""
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
    parser = argparse.ArgumentParser(description='ApiCharge Basic Account Activation Example')
    parser.add_argument('--secret', '-s', required=True, help='Payer Stellar secret key (starts with S)')
    parser.add_argument('--server', default=SERVER_URL, help='ApiCharge server URL')
    parser.add_argument('--new-secret', help='Optional: Provide secret key for new account instead of generating')
    args = parser.parse_args()

    print("=" * 60)
    print("ApiCharge Basic Account Activation Example")
    print("(Phase 1 Only - XLM reserve, NO trustlines)")
    print("=" * 60)
    print()

    try:
        payer_keypair = Keypair.from_secret(args.secret)
    except Exception as e:
        print(f"ERROR: Invalid payer secret key: {e}")
        return

    # Generate or use provided new account
    if args.new_secret:
        try:
            new_account = Keypair.from_secret(args.new_secret)
            print("Using provided new account keypair")
        except Exception as e:
            print(f"ERROR: Invalid new account secret key: {e}")
            return
    else:
        new_account = Keypair.random()
        print("Generated new account keypair")

    print(f"Payer:       {payer_keypair.public_key}")
    print(f"New Account: {new_account.public_key}")
    print(f"Server:      {args.server}")
    print()

    # IMPORTANT: Save the new account's secret key!
    print("=" * 60)
    print("SAVE THIS SECRET KEY - You will need it to use the account!")
    print(f"Secret: {new_account.secret}")
    print("=" * 60)
    print()

    try:
        # Step 1: Fetch quotes
        print("[1/3] Fetching available quotes...")
        quotes = get_quotes(args.server)

        activate_quote = find_quote_by_route_id(quotes, "stablecoin-activate-account")
        if not activate_quote:
            print("ERROR: stablecoin-activate-account route not found")
            return

        price = activate_quote["signableEntity"]["microUnitPrice"] / 1_000_000
        print(f"       Activation price: ${price:.4f} USDC")
        print()

        # Step 2: Purchase access token
        print("[2/3] Purchasing activation access token...")
        token = purchase_access_token(args.server, activate_quote, payer_keypair)
        print("       Access token acquired!")
        print()

        # Step 3: Activate account (Phase 1 only)
        print("[3/3] Activating account (Phase 1)...")
        response = requests.post(
            f"{args.server}/apicharge/stablecoin/activate-account",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={"publicKey": new_account.public_key},
            timeout=60
        )

        if not response.ok:
            print(f"ERROR: Activation failed: {response.status_code}")
            print(f"       {response.text}")
            return

        result = response.json()

        print()
        print("=" * 60)
        print("SUCCESS! Account activated (Phase 1 complete)")
        print("=" * 60)
        print(f"Status:     {result.get('status', 'unknown')}")
        print(f"Account ID: {result.get('accountId', 'unknown')}")
        print(f"TX Hash:    {result.get('transactionHash', 'unknown')}")
        print()
        print("The account now exists with XLM base reserve.")
        print("NOTE: Trustlines are NOT established.")
        print("      To receive USDC/EURC, use activate_account_full_example.py")
        print()
        print(f"View on Stellar Expert:")
        print(f"https://stellar.expert/explorer/public/account/{new_account.public_key}")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Network error: {e}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
