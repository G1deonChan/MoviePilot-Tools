import {
  base64UrlToBytes,
  decodeUtf8,
  decryptAesGcmBox,
  deriveHkdfAesKey,
  encodeUtf8,
  encryptAesGcmBox,
  importAesKey,
} from '../core/crypto'
import type { BackupEnvelopeV1, BackupPayloadV1 } from './backup-schema'
import { parseRecoveryKey } from './backup-key'
import { loadBackupKey } from './backup-key'

const FORMAT = 'mpt2-backup'
const VERSION = 1
const DEK_BYTES = 32

const wrapAad = (keyId: string, snapshotId: string) => `${FORMAT}|${VERSION}|${keyId}|${snapshotId}|dek`
const payloadAad = (keyId: string, snapshotId: string) => `${FORMAT}|${VERSION}|${keyId}|${snapshotId}|gzip|payload`

async function transformBytes(bytes: Uint8Array, format: 'gzip', decompress = false): Promise<Uint8Array<ArrayBuffer>> {
  const stream = decompress ? new DecompressionStream(format) : new CompressionStream(format)
  const input = Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>
  const output = await new Response(new Blob([input]).stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(output)
}

export async function encryptBackupPayload(
  payload: BackupPayloadV1,
  recoveryKey: string,
  snapshotId: string,
): Promise<string> {
  const parsed = await parseRecoveryKey(recoveryKey)
  const dek = crypto.getRandomValues(new Uint8Array(DEK_BYTES))
  try {
    const wrapKey = await deriveHkdfAesKey(parsed.rootKey, 'backup-wrap-v1', ['encrypt'])
    const payloadKey = await importAesKey(dek, ['encrypt'])
    const compressed = await transformBytes(encodeUtf8(JSON.stringify(payload)), 'gzip')
    const [wrappedDek, encryptedPayload] = await Promise.all([
      encryptAesGcmBox(wrapKey, dek, wrapAad(parsed.keyId, snapshotId)),
      encryptAesGcmBox(payloadKey, compressed, payloadAad(parsed.keyId, snapshotId)),
    ])
    const envelope: BackupEnvelopeV1 = {
      format: FORMAT,
      version: VERSION,
      keyId: parsed.keyId,
      snapshotId,
      compression: 'gzip',
      wrappedDek,
      payload: encryptedPayload,
    }
    return JSON.stringify(envelope)
  } finally {
    dek.fill(0)
    parsed.rootKey.fill(0)
  }
}

function assertPayloadShape(payload: BackupPayloadV1): void {
  if (payload.schema !== 1 || typeof payload.createdAt !== 'string' || !payload.createdAt) {
    throw new Error('备份数据版本不受支持')
  }
  if (payload.data !== undefined && (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data))) {
    throw new Error('备份数据结构不正确')
  }
  if (payload.assets !== undefined && (!payload.assets || typeof payload.assets !== 'object' || Array.isArray(payload.assets))) {
    throw new Error('备份资产结构不正确')
  }
}

export async function decryptBackupPayload(text: string, recoveryKey: string): Promise<BackupPayloadV1> {
  let envelope: Partial<BackupEnvelopeV1>
  try {
    envelope = JSON.parse(text) as Partial<BackupEnvelopeV1>
  } catch {
    throw new Error('备份文件格式不正确')
  }
  if (
    envelope.format !== FORMAT || envelope.version !== VERSION || !envelope.keyId ||
    !envelope.snapshotId || envelope.compression !== 'gzip' || !envelope.wrappedDek || !envelope.payload
  ) throw new Error('备份文件格式不正确')

  const parsed = await parseRecoveryKey(recoveryKey)
  if (parsed.keyId !== envelope.keyId) throw new Error('恢复密钥与备份不匹配')
  const wrapKey = await deriveHkdfAesKey(parsed.rootKey, 'backup-wrap-v1', ['decrypt'])
  const dek = await decryptAesGcmBox(wrapKey, envelope.wrappedDek, wrapAad(parsed.keyId, envelope.snapshotId))
  parsed.rootKey.fill(0)
  try {
    const payloadKey = await importAesKey(dek, ['decrypt'])
    const compressed = await decryptAesGcmBox(payloadKey, envelope.payload, payloadAad(parsed.keyId, envelope.snapshotId))
    const plaintext = await transformBytes(compressed, 'gzip', true)
    const payload = JSON.parse(decodeUtf8(plaintext)) as BackupPayloadV1
    assertPayloadShape(payload)
    return payload
  } catch {
    throw new Error('恢复密钥不正确或备份文件已损坏')
  } finally {
    dek.fill(0)
  }
}

export async function openBackupEnvelope(text: string): Promise<BackupPayloadV1> {
  const recoveryKey = await loadBackupKey()
  if (!recoveryKey) throw new Error('请先导入该备份的恢复密钥')
  return decryptBackupPayload(text, recoveryKey)
}

export function recoveryRootKeyFromText(value: string): Uint8Array<ArrayBuffer> {
  return base64UrlToBytes(value)
}
