#!/usr/bin/env python3
"""
ApiCharge Full Account Activation Example
=========================================

This script demonstrates how to fully activate a new Stellar account with
USDC and EURC trustlines using the 2-phase activation flow:

Phase 1: Server creates account with XLM base reserve
Phase 2: Client signs trustline transaction, server fee-bumps and submits

Requirements:
    pip install stellar-sdk requests

Usage:
    python activate_account_full_example.py --secret YOUR_SECRET_KEY

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
    parser = argparse.ArgumentParser(description='ApiCharge Full Account Activation Example')
    parser.add_argument('--secret', '-s', required=True, help='Payer Stellar secret key (starts with S)')
    parser.add_argument('--server', default=SERVER_URL, help='ApiCharge server URL')
    parser.add_argument('--new-secret', help='Optional: Provide secret key for new account instead of generating')
    parser.add_argument('--testnet', action='store_true', help='Use testnet instead of mainnet')
    args = parser.parse_args()

    print("=" * 60)
    print("ApiCharge Full Account Activation Example")
    print("(Phase 1 + Phase 2 - XLM reserve + USDC/EURC trustlines)")
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
    print(f"Network:     {'Testnet' if args.testnet else 'Mainnet'}")
    print()

    # IMPORTANT: Save the new account's secret key!
    print("=" * 60)
    print("SAVE THIS SECRET KEY - You will need it to use the account!")
    print(f"Secret: {new_account.secret}")
    print("=" * 60)
    print()

    try:
        # Step 1: Fetch quotes
        print("[1/5] Fetching available quotes...")
        quotes = get_quotes(args.server)

        activate_quote = find_quote_by_route_id(quotes, "stablecoin-activate-account")
        if not activate_quote:
            print("ERROR: stablecoin-activate-account route not found")
            return

        price = activate_quote["signableEntity"]["microUnitPrice"] / 1_000_000
        print(f"       Activation price: ${price:.4f} USDC")
        print()

        # Step 2: Purchase access token
        print("[2/5] Purchasing activation access token...")
        token = purchase_access_token(args.server, activate_quote, payer_keypair)
        print("       Access token acquired!")
        print()

        # Step 3: Phase 1 - Create account
        print("[3/5] Phase 1: Creating account...")
        response = requests.post(
            f"{args.server}/apicharge/stablecoin/activate-account",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={"publicKey": new_account.public_key},
            timeout=60
        )

        if not response.ok:
            print(f"ERROR: Phase 1 failed: {response.status_code}")
            print(f"       {response.text}")
            return

        phase1_result = response.json()
        print(f"       Status: {phase1_result.get('status', 'unknown')}")
        print(f"       TX Hash: {phase1_result.get('transactionHash', 'unknown')}")
        print()

        # Check if Phase 2 data is available
        ticket = phase1_result.get("ticket")
        trustline_xdr = phase1_result.get("trustlineTransactionXdr")
        trustline_hash = phase1_result.get("trustlineTransactionHash")

        if not ticket or not trustline_xdr:
            print("WARNING: Phase 2 data not returned")
            print("         Account created but trustlines not available")
            print("         This may indicate the account already had trustlines")
            return

        print(f"       Trustline TX Hash: {trustline_hash}")
        print(f"       Ticket received: {ticket[:50]}...")
        print()

        # Step 4: Sign trustline transaction HASH with NEW account's key
        # Using Option B: RawSignature - simpler than parsing XDR
        print("[4/5] Phase 2: Signing trustline transaction hash...")
        print(f"       Signing with new account: {new_account.public_key}")

        # Sign the transaction hash directly (64-byte Ed25519 signature)
        hash_bytes = bytes.fromhex(trustline_hash)
        raw_signature = new_account.sign(hash_bytes)
        raw_signature_base64 = base64.b64encode(raw_signature).decode('utf-8')

        print("       Transaction hash signed!")
        print()

        # Step 5: Submit Phase 2 with raw signature (server wraps into envelope)
        print("[5/5] Phase 2: Submitting signed trustline transaction...")
        response = requests.post(
            f"{args.server}/apicharge/stablecoin/activate-account",
            headers={"apicharge": token, "Content-Type": "application/json"},
            json={
                "publicKey": new_account.public_key,
                "ticket": ticket,
                "callerAccount": new_account.public_key,
                "rawSignature": raw_signature_base64
            },
            timeout=60
        )

        if response.ok:
            print()
            print("=" * 60)
            print("SUCCESS! Account fully activated with trustlines!")
            print("=" * 60)
            print(f"Account: {new_account.public_key}")
            print()
            print("The account now has:")
            print("  - XLM base reserve")
            print("  - USDC trustline (ready to receive USDC)")
            print("  - EURC trustline (ready to receive EURC)")
            print()
            print(f"View on Stellar Expert:")
            print(f"https://stellar.expert/explorer/public/account/{new_account.public_key}")
        else:
            print(f"ERROR: Phase 2 failed: {response.status_code}")
            print(f"       {response.text}")
            print()
            print("Note: Phase 1 succeeded - account exists with XLM")
            print("      Trustlines may need to be added manually")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Network error: {e}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
