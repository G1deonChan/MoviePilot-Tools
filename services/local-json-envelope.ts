import type { CredentialGroup, PtCredential, SiteBlacklistEntry, TotpSite } from '../core/types'
import type { AesGcmBox } from '../core/storage-contracts'
import {
  decodeUtf8,
  decryptAesGcmBox,
  deriveHkdfAesKey,
  encodeUtf8,
  encryptAesGcmBox,
} from '../core/crypto'
import { loadBackupKey, parseRecoveryKey } from './backup-key'

const FORMAT = 'mpt2-local-json'
const VERSION = 1

export type LocalJsonDataType = 'credentials' | 'totp'

export interface CredentialsLocalJsonPayload {
  version: 1
  exportedAt: string
  credentials: PtCredential[]
  credentialGroups?: CredentialGroup[]
  blacklist: SiteBlacklistEntry[]
}

export interface TotpLocalJsonPayload {
  version: 1
  exportedAt: string
  sites: TotpSite[]
}

export type LocalJsonPayloadMap = {
  credentials: CredentialsLocalJsonPayload
  totp: TotpLocalJsonPayload
}

export interface LocalJsonEnvelopeV1 {
  format: typeof FORMAT
  version: typeof VERSION
  type: LocalJsonDataType
  keyId: string
  exportedAt: string
  payload: AesGcmBox
}

function payloadAad(type: LocalJsonDataType, keyId: string, exportedAt: string): string {
  return `${FORMAT}|${VERSION}|${type}|${keyId}|${exportedAt}|payload`
}

function purpose(type: LocalJsonDataType): string {
  return `local-json-${type}-v1`
}

function parseEnvelope(text: string): LocalJsonEnvelopeV1 {
  let envelope: Partial<LocalJsonEnvelopeV1>
  try {
    envelope = JSON.parse(text) as Partial<LocalJsonEnvelopeV1>
  } catch {
    throw new Error('本地 JSON 文件格式不正确')
  }
  if (
    envelope.format !== FORMAT ||
    envelope.version !== VERSION ||
    (envelope.type !== 'credentials' && envelope.type !== 'totp') ||
    !envelope.keyId ||
    !envelope.exportedAt ||
    !envelope.payload
  ) {
    throw new Error('本地 JSON 文件格式不正确')
  }
  return envelope as LocalJsonEnvelopeV1
}

function assertPayload<T extends LocalJsonDataType>(
  type: T,
  value: LocalJsonPayloadMap[T],
): void {
  if (!value || typeof value !== 'object' || value.version !== 1 || !value.exportedAt) {
    throw new Error('本地 JSON 数据版本不受支持')
  }
  if (type === 'credentials') {
    const payload = value as CredentialsLocalJsonPayload
    if (
      !Array.isArray(payload.credentials) ||
      !Array.isArray(payload.blacklist) ||
      (payload.credentialGroups !== undefined && !Array.isArray(payload.credentialGroups))
    ) {
      throw new Error('凭据本地 JSON 数据结构不正确')
    }
  } else {
    const payload = value as TotpLocalJsonPayload
    if (!Array.isArray(payload.sites)) throw new Error('两步验证本地 JSON 数据结构不正确')
  }
}

export function inspectLocalJsonEnvelope(text: string): {
  encrypted: boolean
  type?: LocalJsonDataType
} {
  try {
    const parsed = JSON.parse(text) as Partial<LocalJsonEnvelopeV1>
    if (parsed.format === FORMAT && parsed.version === VERSION) {
      return {
        encrypted: true,
        type: parsed.type === 'credentials' || parsed.type === 'totp' ? parsed.type : undefined,
      }
    }
  } catch {
    return { encrypted: false }
  }
  return { encrypted: false }
}

export async function encryptLocalJson<T extends LocalJsonDataType>(
  type: T,
  payload: LocalJsonPayloadMap[T],
  recoveryKey: string,
): Promise<string> {
  assertPayload(type, payload)
  const parsed = await parseRecoveryKey(recoveryKey)
  try {
    const key = await deriveHkdfAesKey(parsed.rootKey, purpose(type), ['encrypt'])
    const exportedAt = payload.exportedAt
    const encryptedPayload = await encryptAesGcmBox(
      key,
      encodeUtf8(JSON.stringify(payload)),
      payloadAad(type, parsed.keyId, exportedAt),
    )
    const envelope: LocalJsonEnvelopeV1 = {
      format: FORMAT,
      version: VERSION,
      type,
      keyId: parsed.keyId,
      exportedAt,
      payload: encryptedPayload,
    }
    return JSON.stringify(envelope, null, 2)
  } finally {
    parsed.rootKey.fill(0)
  }
}

export async function decryptLocalJson<T extends LocalJsonDataType>(
  text: string,
  expectedType: T,
  recoveryKey: string,
): Promise<LocalJsonPayloadMap[T]> {
  const envelope = parseEnvelope(text)
  if (envelope.type !== expectedType) {
    throw new Error(expectedType === 'credentials' ? '请选择凭据备份文件' : '请选择两步验证备份文件')
  }
  const parsed = await parseRecoveryKey(recoveryKey)
  if (parsed.keyId !== envelope.keyId) throw new Error('恢复密钥与本地 JSON 不匹配')
  try {
    const key = await deriveHkdfAesKey(parsed.rootKey, purpose(expectedType), ['decrypt'])
    const plaintext = await decryptAesGcmBox(
      key,
      envelope.payload,
      payloadAad(expectedType, parsed.keyId, envelope.exportedAt),
    )
    const payload = JSON.parse(decodeUtf8(plaintext)) as LocalJsonPayloadMap[T]
    assertPayload(expectedType, payload)
    return payload
  } catch (error) {
    if (error instanceof Error && error.message.includes('数据')) throw error
    throw new Error('恢复密钥不正确或本地 JSON 文件已损坏')
  } finally {
    parsed.rootKey.fill(0)
  }
}

async function requireSavedRecoveryKey(): Promise<string> {
  const recoveryKey = await loadBackupKey()
  if (!recoveryKey) throw new Error('请先在设置中生成并保存 MPT2-RK1 恢复密钥')
  return recoveryKey
}

export async function encryptLocalJsonWithSavedKey<T extends LocalJsonDataType>(
  type: T,
  payload: LocalJsonPayloadMap[T],
): Promise<string> {
  return encryptLocalJson(type, payload, await requireSavedRecoveryKey())
}

export async function decryptLocalJsonWithSavedKey<T extends LocalJsonDataType>(
  text: string,
  expectedType: T,
): Promise<LocalJsonPayloadMap[T]> {
  return decryptLocalJson(text, expectedType, await requireSavedRecoveryKey())
}
