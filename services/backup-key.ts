import {
  base64UrlToBytes,
  bytesToBase64Url,
  sha256Bytes,
} from '../core/crypto'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'

const RECOVERY_KEY_PREFIX = 'MPT2-RK1'
const RECOVERY_KEY_FILE_FORMAT = 'moviepilot-tools-recovery-key'
const RECOVERY_KEY_FILE_VERSION = 1
const ROOT_KEY_BYTES = 32
const KEY_ID_BYTES = 8

export const RECOVERY_KEY_FILE_ACCEPT = '.mpkey,application/vnd.moviepilot-tools.recovery-key+json'
export const RECOVERY_KEY_FILE_MAX_BYTES = 16 * 1024

export interface RecoveryKeyFileV1 {
  format: typeof RECOVERY_KEY_FILE_FORMAT
  version: typeof RECOVERY_KEY_FILE_VERSION
  keyId: string
  createdAt: string
  recoveryKey: string
}

export interface ParsedRecoveryKey {
  keyId: string
  rootKey: Uint8Array<ArrayBuffer>
}

async function calculateKeyId(rootKey: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(rootKey)
  return [...digest.slice(0, KEY_ID_BYTES)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function createRecoveryKey(rootKey?: Uint8Array): Promise<string> {
  const key = rootKey
    ? Uint8Array.from(rootKey)
    : crypto.getRandomValues(new Uint8Array(ROOT_KEY_BYTES))
  if (key.byteLength !== ROOT_KEY_BYTES) throw new Error('恢复根密钥长度必须为 32 字节')
  const keyId = await calculateKeyId(key)
  return `${RECOVERY_KEY_PREFIX}.${keyId}.${bytesToBase64Url(key)}`
}

export async function parseRecoveryKey(value: string): Promise<ParsedRecoveryKey> {
  const parts = value.trim().split('.')
  if (parts.length !== 3 || parts[0] !== RECOVERY_KEY_PREFIX) {
    throw new Error('恢复密钥格式不正确')
  }
  const keyId = parts[1].toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(keyId)) throw new Error('恢复密钥标识不正确')

  let rootKey: Uint8Array<ArrayBuffer>
  try {
    rootKey = base64UrlToBytes(parts[2])
  } catch {
    throw new Error('恢复根密钥编码不正确')
  }
  if (rootKey.byteLength !== ROOT_KEY_BYTES) throw new Error('恢复根密钥长度必须为 32 字节')
  if ((await calculateKeyId(rootKey)) !== keyId) throw new Error('恢复密钥校验失败')
  return { keyId, rootKey }
}

export async function loadBackupKey(): Promise<string> {
  const backup = (await getPrivateStore()).backup
  if (!backup?.rootKey || !backup.keyId) return ''
  return `MPT2-RK1.${backup.keyId}.${backup.rootKey}`
}

export async function saveBackupKey(value: string): Promise<void> {
  const text = value.trim()
  if (!text) {
    await updatePrivateStore((draft) => { delete draft.backup })
    return
  }
  const parsed = await parseRecoveryKey(text)
  await updatePrivateStore((draft) => {
    draft.backup = { keyId: parsed.keyId, rootKey: bytesToBase64Url(parsed.rootKey) }
  })
  parsed.rootKey.fill(0)
}

export async function generateBackupKey(): Promise<string> {
  return createRecoveryKey()
}

export async function createRecoveryKeyFile(recoveryKey: string, createdAt = new Date().toISOString()): Promise<string> {
  const material = await parseRecoveryKey(recoveryKey)
  const payload: RecoveryKeyFileV1 = {
    format: RECOVERY_KEY_FILE_FORMAT,
    version: RECOVERY_KEY_FILE_VERSION,
    keyId: material.keyId,
    createdAt,
    recoveryKey: recoveryKey.trim(),
  }
  material.rootKey.fill(0)
  return `${JSON.stringify(payload, null, 2)}\n`
}

export async function parseRecoveryKeyFile(content: string): Promise<{ recoveryKey: string; keyId: string }> {
  if (new TextEncoder().encode(content).byteLength > RECOVERY_KEY_FILE_MAX_BYTES) {
    throw new Error('恢复密钥文件过大')
  }

  let payload: unknown
  try {
    payload = JSON.parse(content)
  } catch {
    throw new Error('恢复密钥文件格式无效')
  }
  if (!payload || typeof payload !== 'object') throw new Error('恢复密钥文件格式无效')

  const file = payload as Partial<RecoveryKeyFileV1>
  if (file.format !== RECOVERY_KEY_FILE_FORMAT || file.version !== RECOVERY_KEY_FILE_VERSION) {
    throw new Error('不支持的恢复密钥文件')
  }
  if (typeof file.keyId !== 'string' || typeof file.recoveryKey !== 'string') {
    throw new Error('恢复密钥文件内容不完整')
  }

  const material = await parseRecoveryKey(file.recoveryKey)
  if (material.keyId !== file.keyId) {
    material.rootKey.fill(0)
    throw new Error('恢复密钥文件校验失败')
  }
  material.rootKey.fill(0)
  return { recoveryKey: file.recoveryKey.trim(), keyId: file.keyId }
}

export function recoveryKeyFileName(keyId: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '')
  return `MoviePilot-Tools-Recovery-${keyId}-${stamp}.mpkey`
}
