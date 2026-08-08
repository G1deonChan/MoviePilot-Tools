import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeUtf8,
  decryptAesGcmBox,
  deriveHkdfAesKey,
  encodeUtf8,
  encryptAesGcmBox,
  importAesKey,
} from './crypto'
import type { LocalVaultEnvelopeV1, PrivateStoreV1 } from './storage-contracts'
import { compactPrivateStore, stableStringify } from './storage-policy'
import { calculateRootKeyId } from './device-root'

const FORMAT = 'mpt2-local-vault'
const VERSION = 1
const DEK_BYTES = 32
const WRAP_PURPOSE = 'local-wrap-v1'

function wrapAad(keyId: string): string {
  return `${FORMAT}|${VERSION}|${keyId}|private|dek`
}

function payloadAad(keyId: string): string {
  return `${FORMAT}|${VERSION}|${keyId}|private|payload`
}

function assertEnvelope(envelope: LocalVaultEnvelopeV1): void {
  if (envelope.format !== FORMAT || envelope.version !== VERSION) {
    throw new Error('本地私有仓格式不受支持')
  }
  if (!/^[0-9a-f]{16}$/.test(envelope.keyId)) throw new Error('本地私有仓密钥标识不正确')
}

function assertPrivateStore(value: unknown): asserts value is PrivateStoreV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('私有仓数据格式不正确')
  if ((value as { schema?: unknown }).schema !== 1) throw new Error('私有仓数据版本不受支持')
}

export async function encryptLocalVault(
  privateStore: PrivateStoreV1,
  rootKey: Uint8Array,
): Promise<LocalVaultEnvelopeV1> {
  const compacted = compactPrivateStore(privateStore)
  if (!compacted) throw new Error('私有仓为空，无需加密')

  const keyId = await calculateRootKeyId(rootKey)
  const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES))
  const wrapKey = await deriveHkdfAesKey(rootKey, WRAP_PURPOSE, ['encrypt'])
  const payloadKey = await importAesKey(dek, ['encrypt'])
  const [wrappedDek, payload] = await Promise.all([
    encryptAesGcmBox(wrapKey, dek, wrapAad(keyId)),
    encryptAesGcmBox(payloadKey, encodeUtf8(stableStringify(compacted)), payloadAad(keyId)),
  ])
  dek.fill(0)
  return { format: FORMAT, version: VERSION, keyId, wrappedDek, payload }
}

export async function decryptLocalVault(
  envelope: LocalVaultEnvelopeV1,
  rootKey: Uint8Array,
): Promise<PrivateStoreV1> {
  assertEnvelope(envelope)
  const keyId = await calculateRootKeyId(rootKey)
  if (envelope.keyId !== keyId) throw new Error('本地私有仓不属于当前设备')

  const wrapKey = await deriveHkdfAesKey(rootKey, WRAP_PURPOSE, ['decrypt'])
  const dek = await decryptAesGcmBox(wrapKey, envelope.wrappedDek, wrapAad(keyId))
  try {
    if (dek.byteLength !== DEK_BYTES) throw new Error('私有仓数据密钥长度不正确')
    const payloadKey = await importAesKey(dek, ['decrypt'])
    const plaintext = await decryptAesGcmBox(payloadKey, envelope.payload, payloadAad(keyId))
    let parsed: unknown
    try {
      parsed = JSON.parse(decodeUtf8(plaintext))
    } catch {
      throw new Error('私有仓正文不是有效 JSON')
    }
    assertPrivateStore(parsed)
    const compacted = compactPrivateStore(parsed)
    if (!compacted) throw new Error('私有仓正文为空')
    return compacted
  } finally {
    dek.fill(0)
  }
}

export function decodeLocalVaultRootKey(value: string): Uint8Array<ArrayBuffer> {
  return base64UrlToBytes(value)
}

export function encodeLocalVaultRootKey(value: Uint8Array): string {
  return bytesToBase64Url(value)
}
