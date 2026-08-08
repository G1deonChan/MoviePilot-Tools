import { describe, expect, it } from 'vitest'
import { bufToB64, deriveAesKey } from '../core/crypto'
import { createRecoveryKey } from '../services/backup-key'
import { encryptLocalJson } from '../services/local-json-envelope'
import {
  importCompatibleLocalJson,
  inspectLocalJsonImport,
} from '../services/local-json-import-compat'

const LEGACY_PASSWORD = 'legacy-backup-key'

async function legacyEnvelope(
  type: 'pt-credentials-backup' | 'totp-backup',
  payload: object,
  password = LEGACY_PASSWORD,
): Promise<string> {
  const iterations = 600_000
  const salt = new Uint8Array(32).fill(type === 'pt-credentials-backup' ? 11 : 12)
  const iv = new Uint8Array(12).fill(type === 'pt-credentials-backup' ? 21 : 22)
  const key = await deriveAesKey(`mp-ext-pt-backup-v1:${password}`, salt, iterations)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  return JSON.stringify({
    type,
    version: 2,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ciphertext: bufToB64(new Uint8Array(ciphertext)),
  })
}

describe('旧项目正式加密 JSON 兼容导入', () => {
  it('识别凭据和 TOTP v2 加密信封', async () => {
    const credentials = await legacyEnvelope('pt-credentials-backup', { credentials: [] })
    const totp = await legacyEnvelope('totp-backup', { sites: [] })

    expect(inspectLocalJsonImport(credentials)).toEqual({
      format: 'legacy-credentials-v2',
      type: 'credentials',
      needsLegacyPassword: true,
    })
    expect(inspectLocalJsonImport(totp)).toEqual({
      format: 'legacy-totp-v2',
      type: 'totp',
      needsLegacyPassword: true,
    })
  })

  it('解密并规范化旧版凭据与黑名单', async () => {
    const text = await legacyEnvelope('pt-credentials-backup', {
      credentials: [{
        id: 'old-credential',
        domain: ' example.com ',
        username: ' user ',
        password: 'password',
        name: 'Example',
        category: 'pt',
        groupId: 'group-1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: 'invalid',
      }],
      credentialGroups: [{ id: 'group-1', name: '家庭' }],
      blacklist: [{
        id: 'old-blacklist',
        domain: ' example.com ',
        blockLoginFill: true,
        blockCaptchaFill: false,
        blockCredentialSavePrompt: true,
      }],
      exportedAt: '2025-02-01T00:00:00.000Z',
    })

    const result = await importCompatibleLocalJson(text, 'credentials', LEGACY_PASSWORD)

    expect(result.type).toBe('credentials')
    if (result.type !== 'credentials') throw new Error('unexpected result')
    expect(result.source).toBe('legacy-credentials-v2')
    expect(result.payload.credentials[0]).toMatchObject({
      id: 'old-credential',
      domain: 'example.com',
      username: 'user',
      password: 'password',
      category: 'pt',
      groupId: 'group-1',
    })
    expect(result.payload.credentialGroups).toEqual([
      expect.objectContaining({ id: 'group-1', name: '家庭' }),
    ])
    expect(result.payload.blacklist[0]).toMatchObject({
      id: 'old-blacklist',
      domain: 'example.com',
      blockLoginFill: true,
      blockCaptchaFill: false,
      blockCredentialSavePrompt: true,
    })
  })

  it('将旧版内网凭据自动归入内网分组', async () => {
    const text = await legacyEnvelope('pt-credentials-backup', {
      credentials: [{
        domain: ' http://192.168.1.10:5000 ',
        username: 'admin',
        password: 'password',
      }],
    })

    const result = await importCompatibleLocalJson(text, 'credentials', LEGACY_PASSWORD)

    expect(result.type).toBe('credentials')
    if (result.type !== 'credentials') throw new Error('unexpected result')
    expect(result.payload.credentials[0]).toMatchObject({
      domain: 'http://192.168.1.10:5000',
      category: 'intranet',
    })
  })

  it('解密并规范化旧版 TOTP', async () => {
    const text = await legacyEnvelope('totp-backup', {
      version: '1.0.0',
      sites: [{
        name: 'Example',
        secret: 'jbsw y3dp ehpk 3pxp',
        url: 'https://www.example.com/login',
        icon: 'https://example.com/favicon.ico',
        color: '#1677ff',
      }],
      exportedAt: '2025-03-01T00:00:00.000Z',
    })

    const result = await importCompatibleLocalJson(text, 'totp', LEGACY_PASSWORD)

    expect(result.type).toBe('totp')
    if (result.type !== 'totp') throw new Error('unexpected result')
    expect(result.source).toBe('legacy-totp-v2')
    expect(result.payload.sites[0]).toMatchObject({
      name: 'Example',
      secret: 'JBSWY3DPEHPK3PXP',
      url: 'https://www.example.com/login',
      domain: 'example.com',
      icon: 'https://example.com/favicon.ico',
      category: 'pt',
    })
    expect(result.warnings).toEqual(['已忽略 1 条旧版颜色字段'])
  })

  it('拒绝错误旧版备份密钥', async () => {
    const text = await legacyEnvelope('totp-backup', { sites: [] })
    await expect(importCompatibleLocalJson(text, 'totp', 'wrong')).rejects.toThrow(
      '旧版备份密钥不正确或文件已损坏',
    )
  })

  it('拒绝跨类型导入', async () => {
    const text = await legacyEnvelope('pt-credentials-backup', { credentials: [] })
    await expect(importCompatibleLocalJson(text, 'totp', LEGACY_PASSWORD)).rejects.toThrow(
      '请选择两步验证备份文件',
    )
  })

  it('拒绝明文和设备绑定密文', async () => {
    const plain = JSON.stringify({ credentials: [] })
    const deviceBound = JSON.stringify({ salt: 'AA==', iv: 'AA==', ciphertext: 'AA==' })

    expect(inspectLocalJsonImport(plain).format).toBe('unsupported')
    expect(inspectLocalJsonImport(deviceBound).format).toBe('unsupported')
    await expect(importCompatibleLocalJson(plain, 'credentials')).rejects.toThrow(
      '不支持的本地 JSON 文件格式',
    )
  })

  it('继续支持 2.0 加密信封', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(9))
    const text = await encryptLocalJson('credentials', {
      version: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      credentials: [],
      blacklist: [],
    }, recoveryKey)

    expect(inspectLocalJsonImport(text)).toEqual({
      format: 'mpt2-v1',
      type: 'credentials',
      needsLegacyPassword: false,
    })
  })
})
