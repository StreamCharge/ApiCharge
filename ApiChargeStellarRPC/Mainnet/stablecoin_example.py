#!/usr/bin/env python3
"""
ApiCharge Stablecoin-Native Example Script
==========================================

This script demonstrates how to send a fee-sponsored USDC payment using
the ApiCharge Stablecoin-Native endpoints on mainnet.

Requirements:
    pip install stellar-sdk requests

Usage:
    python stablecoin_example.py --secret YOUR_SECRET_KEY --recipient GXXXX... --amount 0.0001

The sender account must have USDC balance and a USDC trustline.
"""

import argparse
import json
import urllib.parse
import requests
from stellar_sdk import (
    Keypair,
    Network,
    TransactionBuilder,
    Asset,
    Server,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

# ApiCharge server URL
DEFAULT_SERVER_URL = "https://mainnet.stellar.apicharge.com"

# Mainnet USDC issuer
USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_quotes(server_url: str) -> dict:
    """Fetch available route quotes from the server."""
    response = requests.get(
        f"{server_url}/apicharge/quote",
        verify=True,
        timeout=30
    )
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

    # Step 1: Request purchase instruction
    purchase_request = {
        "clientPublicKey": keypair.public_key,
        "routeQuote": route_quote
    }

    response = requests.post(
        f"{server_url}/apicharge/nanosubscription/PurchaseInstruction",  # Capital P
        json=purchase_request,
        verify=True,
        timeout=60
    )

    if not response.ok:
        print(f"  ERROR: {response.status_code} - {response.text}")
        response.raise_for_status()

    purchase_instruction = response.json()

    print("  Step 2: Signing authorization...")

    # Step 2: Sign the authorization
    auth_to_sign = purchase_instruction.get("authorisationToSign", "")
    auth_bytes = bytes.fromhex(auth_to_sign) if not _is_base64(auth_to_sign) else _b64decode(auth_to_sign)
    signed_auth = keypair.sign(auth_bytes)
    purchase_instruction["authorisationToSign"] = _b64encode(signed_auth)

    print("  Step 3: Purchasing access token...")

    # Step 3: Purchase the access token
    response = requests.post(
        f"{server_url}/apicharge/nanosubscription/Purchase",  # Capital P
        json=purchase_instruction,
        verify=True,
        timeout=60
    )

    if not response.ok:
        print(f"  ERROR: {response.status_code} - {response.text}")
        response.raise_for_status()

    access_token = response.json()

    print("  Step 4: Signing access token...")

    # Step 4: Sign the access token
    signable_entity = access_token.get("signableEntity", {})
    signature_to_sign = signable_entity.get("signature", "")

    if signature_to_sign:
        sig_bytes = _b64decode(signature_to_sign)
        token_signature = keypair.sign(sig_bytes)
        access_token["signature"] = _b64encode(token_signature)

    # URL-encode the token for use in headers
    token_json = json.dumps(access_token, separators=(',', ':'))
    encoded_token = urllib.parse.quote(token_json, safe='')

    return encoded_token


def build_zero_fee_payment(
    sender_keypair: Keypair,
    recipient_public: str,
    amount: str,
    sequence_number: int
) -> str:
    """
    Build a classic USDC payment transaction with ZERO fee.
    The fee will be sponsored by ApiCharge when submitted.
    """
    usdc_asset = Asset("USDC", USDC_ISSUER)

    # Build transaction with fee=0
    builder = TransactionBuilder(
        source_account=_create_account_object(sender_keypair.public_key, sequence_number),
        network_passphrase=Network.PUBLIC_NETWORK_PASSPHRASE,
        base_fee=0  # ZERO FEE - ApiCharge will sponsor
    )

    builder.append_payment_op(
        destination=recipient_public,
        asset=usdc_asset,
        amount=amount
    )

    builder.set_timeout(300)

    transaction = builder.build()
    transaction.sign(sender_keypair)

    return transaction.to_xdr()


def submit_transaction(server_url: str, access_token: str, transaction_xdr: str) -> dict:
    """Submit a signed transaction via the stablecoin submit endpoint."""
    response = requests.post(
        f"{server_url}/apicharge/stablecoin/submit-transaction",
        headers={"apicharge": access_token},
        json={"transactionXdr": transaction_xdr},
        verify=True,
        timeout=60
    )
    response.raise_for_status()
    return response.json()


def check_transaction_status(server_url: str, access_token: str, tx_hash: str) -> dict:
    """Check the status of a submitted transaction."""
    response = requests.post(
        f"{server_url}/apicharge/stablecoin/get-transaction-status",
        headers={"apicharge": access_token},
        json={"transactionHash": tx_hash},
        verify=True,
        timeout=30
    )
    response.raise_for_status()
    return response.json()


def get_account_sequence(public_key: str) -> int:
    """Get the current sequence number for an account from Horizon."""
    # Use public Stellar Horizon for account info
    horizon_url = "https://horizon.stellar.org"
    response = requests.get(
        f"{horizon_url}/accounts/{public_key}",
        timeout=30
    )
    response.raise_for_status()
    return int(response.json()["sequence"])


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

import base64

def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode('utf-8')

def _b64decode(data: str) -> bytes:
    return base64.b64decode(data)

def _is_base64(s: str) -> bool:
    try:
        base64.b64decode(s)
        return True
    except:
        return False

def _create_account_object(public_key: str, sequence: int):
    """Create an Account object for TransactionBuilder."""
    from stellar_sdk import Account
    return Account(public_key, sequence)


# =============================================================================
# MAIN SCRIPT
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='ApiCharge Stablecoin-Native Payment Example')
    parser.add_argument('--secret', '-s', required=True, help='Sender Stellar secret key (starts with S)')
    parser.add_argument('--recipient', '-r', required=True, help='Recipient public key (starts with G)')
    parser.add_argument('--amount', '-a', default='0.0001', help='Amount to send in USDC (default: 0.0001)')
    parser.add_argument('--server', default=DEFAULT_SERVER_URL, help='ApiCharge server URL')
    args = parser.parse_args()

    print("=" * 60)
    print("ApiCharge Stablecoin-Native Payment Example")
    print("=" * 60)
    print()

    # Create keypair from secret
    try:
        sender_keypair = Keypair.from_secret(args.secret)
    except Exception as e:
        print(f"ERROR: Invalid secret key: {e}")
        return

    recipient = args.recipient
    amount = args.amount
    server_url = args.server

    print(f"Sender:    {sender_keypair.public_key}")
    print(f"Recipient: {recipient}")
    print(f"Amount:    {amount} USDC")
    print(f"Server:    {server_url}")
    print()

    try:
        # Step 1: Fetch quotes
        print("[1/6] Fetching available quotes...")
        quotes = get_quotes(server_url)

        # Find the stablecoin submit route
        submit_quote = find_quote_by_route_id(quotes, "stablecoin-submit-classic-tx")
        status_quote = find_quote_by_route_id(quotes, "stablecoin-get-tx-status")

        if not submit_quote:
            print("ERROR: stablecoin-submit-classic-tx route not found")
            return

        if not status_quote:
            print("ERROR: stablecoin-get-tx-status route not found")
            return

        submit_price = submit_quote["signableEntity"]["microUnitPrice"] / 1_000_000
        status_price = status_quote["signableEntity"]["microUnitPrice"] / 1_000_000

        print(f"       Submit route: ${submit_price:.2f} USDC")
        print(f"       Status route: ${status_price:.2f} USDC")
        print(f"       Total cost:   ${submit_price + status_price:.2f} USDC")
        print()

        # Step 2: Purchase submit access token
        print("[2/6] Purchasing submit access token...")
        submit_token = purchase_access_token(server_url, submit_quote, sender_keypair)
        print("       Access token acquired!")
        print()

        # Step 3: Purchase status access token
        print("[3/6] Purchasing status access token...")
        status_token = purchase_access_token(server_url, status_quote, sender_keypair)
        print("       Access token acquired!")
        print()

        # Step 4: Get account sequence number
        print("[4/6] Fetching account sequence number...")
        sequence = get_account_sequence(sender_keypair.public_key)
        print(f"       Sequence: {sequence}")
        print()

        # Step 5: Build and submit transaction
        print("[5/6] Building zero-fee transaction...")
        tx_xdr = build_zero_fee_payment(
            sender_keypair,
            recipient,
            amount,
            sequence
        )
        print("       Transaction built and signed")
        print()

        print("       Submitting to ApiCharge...")
        submit_result = submit_transaction(server_url, submit_token, tx_xdr)
        tx_hash = submit_result.get("transactionHash")

        if not tx_hash:
            print(f"ERROR: Submit failed: {submit_result}")
            return

        print(f"       Transaction hash: {tx_hash}")
        print()

        # Step 6: Wait for confirmation
        print("[6/6] Waiting for confirmation...")
        import time

        for attempt in range(20):
            time.sleep(2)
            status = check_transaction_status(server_url, status_token, tx_hash)
            status_str = status.get("status", "unknown")
            ledger = status.get("ledger", "pending")

            print(f"       Attempt {attempt + 1}/20: status={status_str}, ledger={ledger}")

            if status_str.lower() == "success":
                print()
                print("=" * 60)
                print("SUCCESS! Transaction confirmed!")
                print("=" * 60)
                print(f"Hash:   {tx_hash}")
                print(f"Ledger: {ledger}")
                print(f"View:   https://stellar.expert/explorer/public/tx/{tx_hash}")
                return

            if status_str.lower() == "failed":
                print()
                print("ERROR: Transaction failed")
                print(f"Result XDR: {status.get('resultXdr', 'N/A')}")
                return

        print()
        print("WARNING: Transaction status unknown after 20 attempts")
        print(f"Check manually: https://stellar.expert/explorer/public/tx/{tx_hash}")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Network error: {e}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
