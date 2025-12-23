#!/bin/bash
set -e

# If SSH public key is provided, enable SSH access
if [ -n "$APICHARGE_SSH_PUBKEY" ]; then
    echo "Enabling SSH access..."
    mkdir -p ~/.ssh
    echo "$APICHARGE_SSH_PUBKEY" > ~/.ssh/authorized_keys
    chmod 700 ~/.ssh
    chmod 600 ~/.ssh/authorized_keys
    # Start dropbear SSH server on port 2222 (-R generates host keys, -F stays in foreground but we background it)
    dropbear -R -p 2222 &
    echo "SSH server started on port 2222"
fi

# Start Soroban RPC in the background
/usr/bin/stellar-rpc --config-path /config/soroban-rpc.toml &

# Wait for Soroban RPC to be ready (checking localhost only)
until curl -s http://127.0.0.1:8000 > /dev/null; do
    echo "Waiting for Soroban RPC to start..."
    sleep 5
done
echo "Soroban RPC is ready"

# Check if embedded Redis should be started
if [ "${APICHARGE_USE_EMBEDDED_REDIS,,}" = "true" ]; then
    echo "Starting embedded Redis server..."
    
    # Start Redis with our custom config
    redis-server /etc/redis/redis.conf
    
    # Wait for Redis to be ready
    until redis-cli ping > /dev/null 2>&1; do
        echo "Waiting for Redis to start..."
        sleep 1
    done
    echo "Redis server is ready"
fi

# Start ApiCharge
cd /app
exec ./ApiChargePrototype