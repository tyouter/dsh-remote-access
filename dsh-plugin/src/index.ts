/**
 * DSH remote-access plugin, node half.
 *
 * Registers:
 *   GET  /remote-access/status  - Tailscale, serve, and Cloudflare tunnel state
 *   POST /remote-access/enable  - point `tailscale serve` at the auth proxy
 *
 * All runtime state lives in the remote-access data directory:
 *   <data-dir>/tunnel-url.txt   - current Cloudflare quick-tunnel entry URL
 *   <data-dir>/access-token.txt - cookie-entry token for the Caddy auth proxy
 *
 * The data directory is configurable through DSH_REMOTE_ACCESS_DIR and
 * defaults to ~/.dsh-remote-access. The companion install.ps1 writes the same
 * directory, so the plugin and the tunnel scripts agree without secrets in
 * this source tree.
 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

const execFileAsync = promisify(execFile)

export const name = 'client-ui-remote-access'
export const inject = ['webServer']

interface RemoteStatus {
  tailscale: {
    available: boolean
    online: boolean
    dnsName?: string
    ipv4?: string
    error?: string
  }
  serve: {
    active: boolean
    url?: string
    error?: string
  }
  dsh: {
    port: number
    localUrl: string
  }
  remoteUrl?: string
  remoteAuthUrl?: string
  cloud?: {
    available: boolean
    url?: string
    authUrl?: string
  }
}

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

function remoteDataDir(): string {
  const fromEnv = process.env.DSH_REMOTE_ACCESS_DIR?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh-remote-access')
}

function readDataFile(name: string): string | undefined {
  try {
    const value = readFileSync(join(remoteDataDir(), name), 'utf8').trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function cloudTunnelUrl(): string | undefined {
  const value = readDataFile('tunnel-url.txt')
  return value !== undefined && value.startsWith('https://') ? value : undefined
}

function accessToken(): string | undefined {
  return readDataFile('access-token.txt')
}

interface AccessAccount {
  username?: string
  password?: string
}

function accessAccount(): AccessAccount {
  const content = readDataFile('access-account.txt')
  const result: AccessAccount = {}
  if (content === undefined) return result
  for (const line of content.split(/\r?\n/)) {
    const match = /^(username|password)=(.+)$/.exec(line)
    if (match !== null && match[1] !== undefined && match[2] !== undefined) { result[match[1] as 'username' | 'password'] = match[2] }
  }
  return result
}

/**
 * Embed Basic Auth credentials into an entry URL for the copy-link buttons.
 * The user asked for a link that a second device can open without typing the
 * account/password; the QR codes themselves stay credential-free.
 */
function withAuth(url: string): string | undefined {
  const account = accessAccount()
  if (account.username === undefined || account.password === undefined) return undefined
  try {
    const parsed = new URL(url)
    parsed.username = account.username
    parsed.password = account.password
    return parsed.toString()
  } catch {
    return undefined
  }
}

/**
 * Append the cookie-entry path to a URL when token auth is configured. The
 * Caddy proxy issues a cookie on /enter/<token> and redirects to /, so QR
 * codes can log phones in without asking the user to type credentials.
 */
function withTokenEntry(url: string): string {
  const token = accessToken()
  return token === undefined ? url : `${url.replace(/\/+$/, '')}/enter-${token}`
}

async function run(cmd: string, args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args], {
      timeout: 5000,
      windowsHide: true,
    })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number }
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.message ?? String(error)),
      code: typeof e.code === 'number' ? e.code : 1,
    }
  }
}

function stripTrailingDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value
}

function parseTailscaleStatus(stdout: string): { dnsName?: string; ipv4?: string; online: boolean } {
  try {
    const data = JSON.parse(stdout) as {
      Self?: { DNSName?: string; TailscaleIPs?: string[]; Online?: boolean }
    }
    const self = data.Self
    const dnsName = typeof self?.DNSName === 'string' ? stripTrailingDot(self.DNSName) : undefined
    const ips = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs.filter((ip: string) => ip.includes('.')) : []
    const result: { dnsName?: string; ipv4?: string; online: boolean } = { online: self?.Online === true }
    if (dnsName !== undefined) result.dnsName = dnsName
    if (ips[0] !== undefined) result.ipv4 = ips[0]
    return result
  } catch {
    return { online: false }
  }
}

function parseServeStatus(stdout: string): { active: boolean; url?: string } {
  try {
    const data = JSON.parse(stdout) as {
      ServeConfig?: { HTTPS?: Record<string, { Text?: string; URL?: string }> }
      Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
    }
    const web = data.Web
    if (web !== undefined && web !== null) {
      const entries = Object.entries(web)
      if (entries.length > 0) {
        const [authority, conf] = entries[0] as [string, { Handlers?: Record<string, { Proxy?: string }> }]
        const handlers = conf.Handlers
        const hasProxy = handlers !== undefined && Object.values(handlers).some(handler => typeof handler.Proxy === 'string')
        if (hasProxy) {
          const colon = authority.lastIndexOf(':')
          const hostname = colon === -1 ? authority : authority.slice(0, colon)
          const port = colon === -1 ? '443' : authority.slice(colon + 1)
          return { active: true, url: port === '443' ? `https://${hostname}` : `https://${hostname}:${port}` }
        }
      }
    }
    const https = data.ServeConfig?.HTTPS
    if (https !== undefined && https !== null) {
      const entries = Object.entries(https)
      if (entries.length > 0) {
        const [port, conf] = entries[0] as [string, { Text?: string; URL?: string }]
        const url = conf.Text ?? conf.URL ?? (port === '443' ? undefined : `https://<hostname>:${port}`)
        if (url !== undefined) return { active: true, url }
      }
    }
    return { active: false }
  } catch {
    const match = stdout.match(/https:\/\/[^\s]+/)
    return match !== null ? { active: true, url: match[0] } : { active: false }
  }
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function collectStatus(port: number): Promise<RemoteStatus> {
  const localUrl = `http://127.0.0.1:${String(port)}`
  const [ts, serve] = await Promise.all([
    run('tailscale', ['status', '--json']),
    run('tailscale', ['serve', 'status', '--json']),
  ])

  const parsedTail = ts.code === 0 ? parseTailscaleStatus(ts.stdout) : { online: false }
  const parsedServe = serve.code === 0 ? parseServeStatus(serve.stdout) : { active: false }

  const tailscale: RemoteStatus['tailscale'] = {
    available: ts.code === 0,
    online: parsedTail.online,
    ...(parsedTail.dnsName !== undefined ? { dnsName: parsedTail.dnsName } : {}),
    ...(parsedTail.ipv4 !== undefined ? { ipv4: parsedTail.ipv4 } : {}),
    ...(ts.code !== 0 ? { error: ts.stderr || ts.stdout || 'tailscale CLI unavailable' } : {}),
  }

  const serveInfo: RemoteStatus['serve'] = {
    active: parsedServe.active,
    ...(parsedServe.url !== undefined ? { url: parsedServe.url } : {}),
    ...(serve.code !== 0 ? { error: serve.stderr || serve.stdout || 'tailscale serve status unavailable' } : {}),
  }

  const remoteUrl = parsedTail.dnsName !== undefined
    ? withTokenEntry(parsedServe.url ?? `https://${parsedTail.dnsName}`)
    : undefined

  const cloudUrl = cloudTunnelUrl()
  const remoteAuthUrl = remoteUrl !== undefined ? withAuth(remoteUrl) : undefined
  const cloudAuthUrl = cloudUrl !== undefined ? withAuth(cloudUrl) : undefined

  return {
    tailscale,
    serve: serveInfo,
    dsh: { port, localUrl },
    ...(remoteUrl !== undefined ? { remoteUrl } : {}),
    ...(remoteAuthUrl !== undefined ? { remoteAuthUrl } : {}),
    ...(cloudUrl !== undefined
      ? {
        cloud: {
          available: true,
          url: cloudUrl,
          ...(cloudAuthUrl !== undefined ? { authUrl: cloudAuthUrl } : {}),
        },
      }
      : { cloud: { available: false } }),
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    const port = ctx.webServer.port

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/remote-access/status',
      handler: async (_req, res) => {
        sendJson(res, 200, await collectStatus(port))
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/remote-access/enable',
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          sendJson(res, 403, { ok: false, error: 'enable is only allowed from the local machine' })
          return
        }
        const proxyUrl = process.env.DSH_REMOTE_AUTH_PROXY?.trim() || 'http://127.0.0.1:8080'
        const result = await run('tailscale', ['serve', '--bg', '--https=443', proxyUrl])
        if (result.code !== 0) {
          sendJson(res, 500, { ok: false, error: result.stderr || result.stdout || 'tailscale serve failed' })
          return
        }
        sendJson(res, 200, { ok: true, status: await collectStatus(port) })
      },
    }))

    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-remote-access: routes')
}

