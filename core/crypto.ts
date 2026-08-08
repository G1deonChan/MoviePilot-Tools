// 加密内核：SHA-256 / PBKDF2 / AES-GCM / TOTP（RFC 6238）
// 浏览器原生 Web Crypto，零依赖

const te = new TextEncoder()
const td = new TextDecoder()

export function randomBytes(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len))
}

export function bufToB64(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s)
}

export function b64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const buf = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i)
  return buf as Uint8Array<ArrayBuffer>
}

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', te.encode(data))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 密码（PIN/口令）→ AES-256-GCM 密钥 */
export async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations = 600_000,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te.encode(plaintext))
  return `${bufToB64(iv)}:${bufToB64(new Uint8Array(ct))}`
}

export async function aesDecrypt(key: CryptoKey, packed: string): Promise<string> {
  const [ivB64, ctB64] = packed.split(':')
  if (!ivB64 || !ctB64) throw new Error('密文格式错误')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
    key,
    b64ToBuf(ctB64),
  )
  return td.decode(pt)
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bufToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return b64ToBuf(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return new Uint8Array(digest) as Uint8Array<ArrayBuffer>
}

export async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(data)
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error('AES-256 密钥长度必须为 32 字节')
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, usages)
}

export async function deriveHkdfAesKey(
  rootKey: Uint8Array,
  purpose: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (rootKey.byteLength !== 32) throw new Error('根密钥长度必须为 32 字节')
  const source = await crypto.subtle.importKey('raw', rootKey as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: te.encode(purpose),
    },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

export interface AesGcmBoxData {
  iv: string
  ciphertext: string
}

export async function encryptAesGcmBox(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<AesGcmBoxData> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: te.encode(aad), tagLength: 128 },
    key,
    plaintext as BufferSource,
  )
  return { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) }
}

export async function decryptAesGcmBox(
  key: CryptoKey,
  box: AesGcmBoxData,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(box.iv),
      additionalData: te.encode(aad),
      tagLength: 128,
    },
    key,
    base64UrlToBytes(box.ciphertext),
  )
  return new Uint8Array(plaintext) as Uint8Array<ArrayBuffer>
}

export function encodeUtf8(value: string): Uint8Array {
  return te.encode(value)
}

export function decodeUtf8(value: Uint8Array): string {
  return td.decode(value)
}
