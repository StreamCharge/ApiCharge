# ApiCharge Stellar RPC - Mainnet

A monetizable Stellar Soroban RPC node with built-in payment processing via the ApiCharge reverse proxy. Accept Stellar stablecoin payments for API access without any third-party payment processors.

## Overview

This Docker image bundles:
- **Stellar RPC** (Soroban RPC node) - Full Stellar blockchain RPC access
- **ApiCharge Proxy** - Token-based API monetization and rate limiting
- **Redis** - Token cache and persistence

## Quick Start

Either use the ApiCharge Management App here [ApiCharge Desktop App](https://apicharge.com/apicharge-desktop-app-preview.html) or follow the manual steps below:

```bash
# 1. Pull the image
docker pull apicharge/apicharge-stellar-rpc:mainnet

# 2. Create deployment directory
mkdir apicharge-rpc && cd apicharge-rpc

# 3. Download configuration files
# (Copy docker-compose.yml, appsettings.json, .env.example from this repository)

# 4. Configure environment
cp .env.example .env
# Edit .env with your signing key

# 5. Configure pricing and fund recipient
# Edit appsettings.json (see Configuration section)

# 6. Set up TLS certificate
mkdir certs
# Place your certificate.pfx in ./certs/

# 7. Create config directory
mkdir config

# 8. Start the service
docker-compose up -d
```

## Hardware Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 16 GB | 16+ GB |
| Disk | 160 GB | 250 GB SSD |
| IOPS | 1K | 3K+ |

**Cloud instance examples:** AWS c5.xlarge, GCP n4-highcpu-4

## Storage & Volumes

### Persistent Volumes

| Volume | Path | Purpose | Size |
|--------|------|---------|------|
| `stellar-data` | `/var/lib/stellar` | Blockchain data (captive core + RPC database) | 150-200 GB |
| `redis-data` | `/data/redis` | Token cache persistence | < 1 GB |
| `./certs` | `/certs` | TLS certificate (bind mount) | < 1 MB |
| `./config` | `/app/config` | Custom configs, welcome.html | < 1 MB |
| `./appsettings.json` | `/app/appsettings.json` | Pricing and route configuration | < 100 KB |

### Disk Space Calculation

The Stellar blockchain data size depends on the history retention window:

```
Disk = 20 GB base + (20 GB × retention days)
```

| Retention | Ledgers | Disk Required |
|-----------|---------|---------------|
| 1 day | 17,280 | ~40 GB |
| 3 days | 51,840 | ~80 GB |
| 7 days (default) | 120,960 | ~160 GB |

### Adjusting History Retention

To reduce disk usage, edit `soroban-rpc.toml`:

```toml
# Default: 7 days (120960 ledgers)
HISTORY_RETENTION_WINDOW = 120960

# Reduced: 3 days
HISTORY_RETENTION_WINDOW = 51840

# Minimal: 1 day
HISTORY_RETENTION_WINDOW = 17280
```

**Note:** Lower retention means clients cannot query older transaction history.

## Configuration

### 1. Environment Variables (.env)

Copy `.env.example` to `.env` and configure:

```bash
# REQUIRED: Your Stellar signing key
# Generate a new keypair: https://laboratory.stellar.org/#account-creator
APICHARGE_SIGNING_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Network passphrase (do not change for mainnet)
APICHARGE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

# Enable embedded Redis
APICHARGE_USE_EMBEDDED_REDIS=true
```

### 2. Pricing Configuration (appsettings.json)

The `appsettings.json` file contains route definitions and pricing. You **must** update:

#### Fund Recipient Address

Replace all instances of the placeholder address (`GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`) with your Stellar public key.

This address receives payments from API consumers.

#### TLS Certificate Password

Update the certificate password (replace `YOUR_CERTIFICATE_PASSWORD` with your actual password).

#### Pricing Configuration

You must configure pricing for each route in the `Quotes` sections. The default values are placeholders and should be changed to reflect your pricing strategy.

For detailed guidance on configuring routes, pricing strategies, and rate limiting, see the [ApiCharge Technical Documentation](https://apicharge.com/Documentation/index.html).

### 3. TLS Certificate

You must provide a valid TLS certificate in PFX format.

**Option A: Let's Encrypt (recommended)**
```bash
# Install certbot and obtain certificate
certbot certonly --standalone -d your-domain.com

# Convert to PFX
openssl pkcs12 -export \
  -out certs/certificate.pfx \
  -inkey /etc/letsencrypt/live/your-domain.com/privkey.pem \
  -in /etc/letsencrypt/live/your-domain.com/fullchain.pem \
  -password pass:YOUR_PASSWORD
```

**Option B: Self-signed (development only)**
```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
openssl pkcs12 -export -out certs/certificate.pfx -inkey key.pem -in cert.pem
```

The certificate must be renewed before expiry and the container restarted.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 80 | HTTP | API access (redirects to HTTPS) |
| 443 | HTTPS | Secure API access |

## Initial Sync

On first start, the Stellar RPC node must sync with the network. This takes approximately:
- **Mainnet:** 20-60 minutes depending on disk speed
- **Progress:** Check logs with `docker-compose logs -f`

The API will return errors until sync completes. Look for:
```
Soroban RPC is ready
```

## API Endpoints

Once running, your node exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Welcome page |
| `GET /apicharge/quote` | Get pricing quotes |
| `POST /apicharge/purchase` | Purchase access token |
| `POST /soroban/*` | Soroban RPC (requires token) |
| `POST /apicharge/stablecoin/*` | Stablecoin operations (requires token) |

## Monitoring

### Health Check
```bash
curl -X POST https://your-domain.com/soroban/ \
  -H "Content-Type: application/json" \
  -H "apicharge: YOUR_ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

### Logs
```bash
docker-compose logs -f apicharge-stellar-rpc
```

### Container Status
```bash
docker-compose ps
```

## Backup & Recovery

### Critical Data to Backup

1. **`.env`** - Contains signing key
2. **`appsettings.json`** - Pricing configuration
3. **`certs/certificate.pfx`** - TLS certificate
4. **Redis volume** - Active token sessions (optional)

### Data You Don't Need to Backup

- **Stellar data volume** - Rebuilds from network on restart (slow but automatic)

## Troubleshooting

### "Connection refused" on startup
The RPC node is still syncing. Wait for sync to complete.

### Certificate errors
Ensure `certificate.pfx` exists in `./certs/` and password in `appsettings.json` is correct.

### "Invalid signature" on token purchase
The signing key in `.env` doesn't match what's expected. Ensure you're using the correct keypair.

### Disk full
Reduce `HISTORY_RETENTION_WINDOW` in `soroban-rpc.toml` or add more disk.

### High memory usage
Redis and the RPC node both consume memory. Ensure at least 16GB RAM.

## Security Considerations

- **Never commit `.env`** - Contains your signing key
- **Rotate signing keys** periodically for production
- **Monitor fund recipient** - Regularly check your balance
- **Keep certificates valid** - Set up renewal reminders

## Support

- Documentation: https://apicharge.com/Documentation/index.html
- Stellar RPC Docs: https://developers.stellar.org/docs/data/apis/rpc
