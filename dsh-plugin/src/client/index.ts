/**
 * DSH remote-access plugin, browser half.
 * Adds the "远程连接" footer action with two QR codes:
 *   1. Tailscale channel
 *   2. Cloudflare tunnel channel
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RemoteAccessAction } from './RemoteAccessAction.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'remote-access',
    order: 0,
  }, RemoteAccessAction))
}
