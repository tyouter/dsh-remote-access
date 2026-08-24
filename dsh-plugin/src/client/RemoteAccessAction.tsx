/**
 * Sidebar footer action: open the remote-access QR dialog.
 */
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode/lib/browser'
import {
  IconLinkOutline14,
  IconRefreshOutline16,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './RemoteAccessAction.module.css'

export type RemoteAccessActionProps = PropsRuntime<'sidebar.footer.action'>

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
  cloud?: {
    available: boolean
    url?: string
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

const QR_OPTIONS = { width: 160, margin: 1, errorCorrectionLevel: 'M' as const }

export function RemoteAccessAction({ wide }: RemoteAccessActionProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [cloudQrDataUrl, setCloudQrDataUrl] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      window.setTimeout(() => setCopiedUrl((current) => current === url ? null : current), 2000)
    } catch {
      // Clipboard may be unavailable in insecure contexts; the QR remains usable.
    }
  }, [])

  const applyStatus = useCallback(async (data: RemoteStatus) => {
    setStatus(data)
    setQrDataUrl(data.remoteUrl !== undefined
      ? await QRCode.toDataURL(data.remoteUrl, QR_OPTIONS)
      : null)
    setCloudQrDataUrl(data.cloud?.url !== undefined
      ? await QRCode.toDataURL(data.cloud.url, QR_OPTIONS)
      : null)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/remote-access/status', {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`status request failed: ${response.status}`)
      await applyStatus(await response.json() as RemoteStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setQrDataUrl(null)
      setCloudQrDataUrl(null)
    } finally {
      setLoading(false)
    }
  }, [applyStatus])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const enable = useCallback(async () => {
    setEnabling(true)
    setError(null)
    try {
      const response = await fetch('/remote-access/enable', { method: 'POST' })
      const data = await response.json() as { ok: boolean; error?: string; status?: RemoteStatus }
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error ?? `enable failed: ${response.status}`)
      }
      if (data.status !== undefined) await applyStatus(data.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEnabling(false)
    }
  }, [applyStatus])

  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])
  const remoteHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const onLocalMachine = isLoopbackHost(remoteHost)

  return (
    <>
      <Tooltip label="远程连接" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.actionButton}
          aria-label="远程连接"
          aria-expanded={open}
          onClick={onOpen}
        >
          <IconLinkOutline14 size={wide ? 14 : 18} />
          {wide && <span className={css.actionLabel}>远程连接</span>}
        </button>
      </Tooltip>

      <Modal
        open={open}
        onClose={onClose}
        title="远程连接"
        closeLabel="关闭"
        description="扫码即可在手机或其他设备上打开本机 DSH。"
      >
        <div className={css.body}>
          {loading && status === null && <p className={css.note}>正在检测远程通道…</p>}

          {error !== null && <p className={css.error} role="alert">{error}</p>}

          {!loading && status !== null && (
            <>
              <div className={css.section}>
                <div className={css.row}>
                  <span className={css.badge}>
                    Tailscale：{status.tailscale.available ? (status.tailscale.online ? '在线' : '离线') : '未安装'}
                  </span>
                  {status.tailscale.dnsName !== undefined && (
                    <span className={css.muted}>{status.tailscale.dnsName}</span>
                  )}
                </div>
                {status.serve.active && status.serve.url !== undefined && (
                  <div className={css.row}>
                    <span className={css.badge}>serve：已开启</span>
                    <span className={css.muted}>{status.serve.url}</span>
                  </div>
                )}
                {status.cloud?.available === true && status.cloud.url !== undefined && (
                  <div className={css.row}>
                    <span className={css.badge}>公网隧道：已开启</span>
                  </div>
                )}
              </div>

              {(qrDataUrl !== null || cloudQrDataUrl !== null) && (
                <div className={css.qrGrid}>
                  {qrDataUrl !== null && status.remoteUrl !== undefined && (
                    <div className={css.qrCard}>
                      <p className={css.qrLabel}>Tailscale 通道</p>
                      <img className={css.qr} src={qrDataUrl} alt="Tailscale 通道二维码" />
                      <button type="button" className={css.copyButton} onClick={() => void copyUrl(status.remoteUrl!)}>
                        {copiedUrl === status.remoteUrl ? '已复制' : '复制链接'}
                      </button>
                    </div>
                  )}
                  {cloudQrDataUrl !== null && status.cloud?.url !== undefined && (
                    <div className={css.qrCard}>
                      <p className={css.qrLabel}>外出高速通道</p>
                      <img className={css.qr} src={cloudQrDataUrl} alt="外出高速通道二维码" />
                      <button type="button" className={css.copyButton} onClick={() => void copyUrl(status.cloud!.url!)}>
                        {copiedUrl === status.cloud.url ? '已复制' : '复制链接'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {qrDataUrl === null && cloudQrDataUrl === null && (
                <p className={css.note}>暂无可用的远程二维码，请先运行 install.ps1。</p>
              )}

              <div className={css.actions}>
                {status.tailscale.available && !status.serve.active && onLocalMachine && (
                  <button type="button" className={css.primary} disabled={enabling} onClick={() => void enable()}>
                    {enabling ? '正在开启…' : '开启 Tailscale serve'}
                  </button>
                )}
                <button type="button" className={css.secondary} disabled={loading} onClick={() => void refresh()}>
                  <IconRefreshOutline16 size={14} />
                  刷新
                </button>
              </div>
            </>
          )}

          <div className={css.hint}>
            <p>1. Tailscale 通道需要手机登录同一网络。</p>
            <p>2. 外出高速通道扫码后自动进入，无需输入账号密码。</p>
            <p>3. DSH 本身仍只监听本机回环地址。</p>
          </div>
        </div>
      </Modal>
    </>
  )
}
