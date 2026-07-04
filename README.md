# OpenMote

Remote control opencode via web with QR codes and tunneling.

## Installation

```bash
npm install -g /path/to/openmote
# or link locally
npm link /path/to/openmote
```

## Usage

```bash
openmote [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--bare-bones` | Use opencode web instead of custom server |
| `--bare` | Local network only (no auth required) |
| `--tunnel <type>` | Public URL via tailscale/ngrok/cloudflare |
| `--caffeinate` | Prevent system sleep while running |
| `--login <str>` | Auth for both username and password (required for tunnel mode) |
| `--port <n>` | Server port (default: 3119) |
| `--help` | Show help |

## Examples

```bash
# Bare bones - vanilla opencode web with QR + LAN access
openmote --bare-bones

# Full mode - local access with keep-awake
openmote --bare --caffeinate

# Full mode - public tunnel via tailscale (login required)
openmote --tunnel tailscale --login mypass

# Custom port
openmote --bare --port 8080
```

## Tailscale Funnel Setup

For Tailscale tunneling to work, Funnel must be enabled by your Tailscale admin:

1. Go to https://login.tailscale.com/admin/settings#funnel
2. Enable "Allow Funnel" for your account or tailnet

The FQDN is auto-detected from `tailscale status --json`. If Funnel is unavailable, the default URL `https://openmote.ts.net` will be shown.

**Note:** The Tailscale App for macOS includes the CLI at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. OpenMote detects this automatically.