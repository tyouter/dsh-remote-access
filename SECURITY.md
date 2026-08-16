# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security-sensitive reports.
Instead, use GitHub's private vulnerability reporting feature on this repository.

## Security model

This project never asks you to expose DSH itself to a public port.

- DSH keeps binding to `127.0.0.1:<port>`
- A local Caddy reverse proxy is the only component that forwards traffic to DSH
- Caddy requires a cookie issued by `/enter/<random-token>`
- Unauthenticated requests receive `401`
- The Cloudflare quick tunnel is random and unlisted, but it is still reachable by anyone who obtains the URL
- The access token is generated locally and stored under `~/.dsh-remote-access/`

## What to keep private

Never commit, paste, or share:

- `tunnel-url.txt`
- `access-token.txt`
- QR codes generated from the entry URL
- Tailscale hostnames/IPs or any personal network details

The examples in this repository use placeholders only.

## Recommended practices

- Use the latest cloudflared and Caddy releases
- Regenerate the token after sharing a device or losing a phone:

  ```powershell
  .\uninstall.ps1 -RemoveData
  .\install.ps1
  ```

- Keep your operating system firewall enabled
- Do not modify Caddy to skip the cookie check unless you add an equivalent authentication layer
