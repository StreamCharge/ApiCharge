# ApiCharge Stellar RPC - Bare Metal Deployment (Testnet)

Deploy ApiCharge with Stellar Soroban RPC on bare metal Linux servers using systemd.

**This is the TESTNET deployment.** For mainnet, see [../Mainnet/](../Mainnet/).

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| OS | Ubuntu 22.04+ x64 | Ubuntu 24.04 LTS |
| CPU | 2 vCPU | 4+ vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB SSD | 30 GB NVMe |
| IOPS | 1K | 3K+ |

> **Note:** Testnet uses less disk space than mainnet due to shorter history.

## Quick Start

```bash
# 1. Download the release package (or clone this directory)
wget https://github.com/ApiChargeOrg/ApiChargeStellarRPC/releases/latest/download/systemd-testnet.tar.gz
tar -xzf systemd-testnet.tar.gz
cd systemd-testnet

# 2. Add your ApiCharge binary
# Download or build ApiChargePrototype and place it in this directory
cp /path/to/ApiChargePrototype .

# 3. Run the installer
sudo ./install.sh

# 4. Configure your signing key
sudo nano /etc/apicharge/apicharge.env
# Set: APICHARGE_SIGNING_KEY=S...your key...
# Fund via: https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY

# 5. (Optional) Add TLS certificate
sudo cp your-certificate.pfx /etc/apicharge/certs/certificate.pfx
sudo chown apicharge:apicharge /etc/apicharge/certs/certificate.pfx
# Update password in /etc/apicharge/appsettings.json

# 6. Restart to apply changes
sudo systemctl restart apicharge
```

## Testnet Friendbot

To fund your testnet account:

```bash
# Get your public key from your secret key, then:
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```

## Directory Structure

After installation:

```
/opt/apicharge/                    # Binaries (replaced on upgrade)
└── ApiChargePrototype

/etc/apicharge/                    # Configuration (preserved on upgrade)
├── apicharge.env                  # Secrets (signing key)
├── appsettings.json               # ApiCharge configuration
├── redis.conf                     # Redis configuration
├── soroban-rpc.toml               # Soroban RPC configuration
├── stellar-core.cfg               # Stellar Core configuration
├── welcome.html                   # Welcome page
└── certs/
    └── certificate.pfx            # TLS certificate (you provide)

/var/lib/apicharge/                # Data (NEVER touched on upgrade)
├── redis/                         # Redis persistence
│   └── appendonly.aof
└── stellar/                       # Stellar blockchain data
    ├── captive-core/              # Captive Core data
    │   └── stellar.db
    └── soroban-rpc-db.sqlite      # Soroban RPC database
```

## Services

Three systemd services are installed:

| Service | Description | Port |
|---------|-------------|------|
| `apicharge-redis` | Redis cache | 127.0.0.1:6379 |
| `apicharge-soroban-rpc` | Stellar Soroban RPC | 127.0.0.1:8000 |
| `apicharge` | ApiCharge proxy | 0.0.0.0:80, 443 |

### Service Commands

```bash
# Check status
sudo systemctl status apicharge
sudo systemctl status apicharge-soroban-rpc
sudo systemctl status apicharge-redis

# View logs
sudo journalctl -u apicharge -f
sudo journalctl -u apicharge-soroban-rpc -f

# Restart
sudo systemctl restart apicharge

# Stop all
sudo systemctl stop apicharge apicharge-soroban-rpc apicharge-redis
```

## Upgrading

The installer is idempotent. To upgrade:

```bash
# 1. Download new release
cd /path/to/new-release

# 2. Replace binary
cp /path/to/new/ApiChargePrototype .

# 3. Run installer again
sudo ./install.sh
```

**What happens on upgrade:**
- ✅ Binaries are **replaced** with new versions
- ✅ Systemd units are **replaced** with new versions
- ⚠️ Configs are **preserved** (not overwritten)
- ⚠️ Data is **preserved** (never touched)

## Troubleshooting

### Soroban RPC not starting

First sync takes time. Monitor progress:
```bash
sudo journalctl -u apicharge-soroban-rpc -f
```

### Permission errors

Reset permissions:
```bash
sudo chown -R apicharge:apicharge /opt/apicharge /etc/apicharge /var/lib/apicharge
```

### Reset all data (start fresh)

```bash
sudo systemctl stop apicharge apicharge-soroban-rpc apicharge-redis
sudo rm -rf /var/lib/apicharge/*
sudo systemctl start apicharge-redis apicharge-soroban-rpc apicharge
```

## Support

- Documentation: https://apicharge.com/Documentation/
- Issues: https://github.com/ApiChargeOrg/ApiChargeStellarRPC/issues
