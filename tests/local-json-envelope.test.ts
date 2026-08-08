import { describe, expect, it } from 'vitest'
import { createRecoveryKey } from '../services/backup-key'
import {
  decryptLocalJson,
  encryptLocalJson,
  inspectLocalJsonEnvelope,
  type CredentialsLocalJsonPayload,
  type TotpLocalJsonPayload,
} from '../services/local-json-envelope'

const credentialsPayload: CredentialsLocalJsonPayload = {
  version: 1,
  exportedAt: '2026-07-23T00:00:00.000Z',
  credentials: [
    {
      id: 'credential-1',
      domain: 'example.com',
      username: 'user',
      password: 'password',
      groupId: 'group-1',
    },
  ],
  credentialGroups: [{ id: 'group-1', name: '家庭' }],
  blacklist: [],
}

const totpPayload: TotpLocalJsonPayload = {
  version: 1,
  exportedAt: '2026-07-23T00:00:00.000Z',
  sites: [{ id: 'totp-1', name: 'Example', secret: 'SECRET' }],
}

describe('2.0 本地 JSON 加密信封', () => {
  it('凭据使用恢复密钥加密并往返解密', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(3))
    const text = await encryptLocalJson('credentials', credentialsPayload, recoveryKey)

    expect(text).not.toContain('password')
    expect(inspectLocalJsonEnvelope(text)).toEqual({ encrypted: true, type: 'credentials' })
    await expect(decryptLocalJson(text, 'credentials', recoveryKey)).resolves.toEqual(credentialsPayload)
  })

  it('两步验证使用独立用途加密并往返解密', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(4))
    const text = await encryptLocalJson('totp', totpPayload, recoveryKey)

    expect(text).not.toContain('SECRET')
    expect(inspectLocalJsonEnvelope(text)).toEqual({ encrypted: true, type: 'totp' })
    await expect(decryptLocalJson(text, 'totp', recoveryKey)).resolves.toEqual(totpPayload)
  })

  it('拒绝将凭据文件导入两步验证', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(5))
    const text = await encryptLocalJson('credentials', credentialsPayload, recoveryKey)

    await expect(decryptLocalJson(text, 'totp', recoveryKey)).rejects.toThrow('请选择两步验证备份文件')
  })

  it('拒绝错误恢复密钥', async () => {
    const correct = await createRecoveryKey(new Uint8Array(32).fill(6))
    const wrong = await createRecoveryKey(new Uint8Array(32).fill(7))
    const text = await encryptLocalJson('totp', totpPayload, correct)

    await expect(decryptLocalJson(text, 'totp', wrong)).rejects.toThrow('恢复密钥与本地 JSON 不匹配')
  })

  it('密文或元数据被修改后无法解密', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(8))
    const text = await encryptLocalJson('credentials', credentialsPayload, recoveryKey)
    const envelope = JSON.parse(text) as { exportedAt: string }
    envelope.exportedAt = '2026-07-24T00:00:00.000Z'

    await expect(
      decryptLocalJson(JSON.stringify(envelope), 'credentials', recoveryKey),
    ).rejects.toThrow('恢复密钥不正确或本地 JSON 文件已损坏')
  })

  it('普通明文 JSON 不被识别为加密信封', () => {
    expect(inspectLocalJsonEnvelope(JSON.stringify(credentialsPayload))).toEqual({ encrypted: false })
    expect(inspectLocalJsonEnvelope('invalid')).toEqual({ encrypted: false })
  })
})
