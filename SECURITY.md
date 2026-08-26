# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security-sensitive reports.
Instead, use GitHub's private vulnerability reporting feature on this repository.

## Security model

This project never asks you to expose DSH itself to a public port.

- DSH keeps binding to `127.0.0.1:<port>`
- A local Caddy reverse proxy binds to `127.0.0.1:<proxy-port>` only
- Caddy requires HTTP Basic Auth credentials plus a cookie issued by `/enter/<random-token>`
- Unauthenticated requests receive `401`
- The Cloudflare quick tunnel is random and unlisted, but it is still reachable by anyone who obtains the URL
- The access token and account password are generated locally and stored under `~/.dsh-remote-access/`

## What to keep private

Never commit, paste, or share:

- `tunnel-url.txt`
- `access-token.txt`
- `access-account.txt`
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
- Review the Caddy access log (`<data-dir>/logs/access.log`) for unexpected IPs or paths
- Do not modify Caddy to skip the cookie check unless you add an equivalent authentication layer
