import { getPrivateStore, updatePrivateStore } from '../core/private-vault'
import type { TotpSite } from '../core/types'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(output)
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message as BufferSource))
}

export async function generateTotp(
  secret: string,
  digits = 6,
  period = 30,
  timestamp = Date.now(),
): Promise<string> {
  const key = decodeBase32(secret)
  const counter = Math.floor(timestamp / 1000 / period)
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setUint32(0, Math.floor(counter / 0x100000000))
  view.setUint32(4, counter >>> 0)
  const hmac = await hmacSha1(key, new Uint8Array(buffer))
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

export function totpRemaining(period = 30, timestamp = Date.now()): number {
  return period - Math.floor((timestamp / 1000) % period)
}

export async function loadSites(): Promise<TotpSite[]> {
  return (await getPrivateStore()).vault?.totp || []
}

export async function saveSites(list: TotpSite[]): Promise<void> {
  await updatePrivateStore((draft) => {
    draft.vault = { ...(draft.vault || {}), totp: list }
  })
  try {
    const { scheduleAutoBackupOnChange } = await import('./webdav')
    scheduleAutoBackupOnChange()
  } catch {
    // WebDAV 未启用时忽略
  }
  try {
    const { scheduleMpAutoBackupOnChange } = await import('./mp-backup')
    scheduleMpAutoBackupOnChange()
  } catch {
    // MoviePilot 备份未启用时忽略
  }
}

export function codeFor(secret: string): Promise<string> {
  return generateTotp(secret)
}

export function remaining(): number {
  return totpRemaining()
}

interface TotpBackup {
  version: 1
  sites: TotpSite[]
  exportedAt: string
}

export async function importSitesPayload(payload: TotpBackup): Promise<number> {
  const incoming = payload.sites
  if (!Array.isArray(incoming)) throw new Error('文件格式不正确')
  const map = new Map((await loadSites()).map((site) => [site.id, site]))
  const byName = new Map([...map.values()].map((site) => [site.name.toLowerCase(), site.id]))
  for (const site of incoming) {
    if (!site?.secret) continue
    const existingId = site.id && map.has(site.id) ? site.id : byName.get((site.name || '').toLowerCase())
    const id = existingId || site.id || crypto.randomUUID()
    const merged: TotpSite = {
      ...map.get(id),
      ...site,
      id,
      secret: String(site.secret).toUpperCase().replace(/\s/g, ''),
      category: site.category || (site.group as TotpSite['category']) || (site.url || site.domain ? 'pt' : 'custom'),
    }
    map.set(id, merged)
    if (merged.name) byName.set(merged.name.toLowerCase(), id)
  }
  await saveSites([...map.values()])
  return incoming.length
}

export function parseOtpauthUri(uri: string): Omit<TotpSite, 'id'> | null {
  try {
    const url = new URL(uri.trim())
    if (url.protocol !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') return null
    const secret = url.searchParams.get('secret')?.replace(/\s/g, '').toUpperCase() || ''
    if (!secret || !/^[A-Z2-7]+=*$/.test(secret)) return null
    const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const parts = label.split(':')
    let issuer = url.searchParams.get('issuer') || ''
    let account = label
    if (parts.length >= 2) {
      issuer = issuer || parts[0] || ''
      account = parts.slice(1).join(':')
    }
    const name = (account || issuer || '未命名').replace(/^\/+/, '').trim() || '未命名'
    const domain = issuer.trim() || undefined
    return {
      name,
      domain,
      url: domain ? `https://${domain}` : undefined,
      secret,
      group: 'custom',
      category: 'custom',
    }
  } catch {
    return null
  }
}
