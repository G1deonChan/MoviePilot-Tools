import { describe, expect, it } from 'vitest'
import { decryptBackupPayload, encryptBackupPayload } from '../services/backup-envelope'
import { createRecoveryKey } from '../services/backup-key'
import type { BackupPayloadV1 } from '../services/backup-schema'

const payload: BackupPayloadV1 = {
  schema: 1,
  createdAt: '2026-07-22T00:00:00.000Z',
  data: {
    totp: [{ id: '1', name: 'Example', secret: 'SECRET' }],
    credentials: [{ domain: 'example.com', username: 'user', password: 'password' }],
  },
}

describe('BackupEnvelopeV1', () => {
  it('相同恢复密钥可跨设备语义往返恢复', async () => {
    const recoveryKey = await createRecoveryKey(new Uint8Array(32).fill(7))
    const text = await encryptBackupPayload(payload, recoveryKey, 'snapshot-1')
    const envelope = JSON.parse(text) as { format: string; version: number; wrappedDek: unknown; payload: unknown }

    expect(envelope.format).toBe('mpt2-backup')
    expect(envelope.version).toBe(1)
    expect(text).not.toContain('SECRET')
    expect(envelope.wrappedDek).toBeTruthy()
    await expect(decryptBackupPayload(text, recoveryKey)).resolves.toEqual(payload)
  })

  it('错误恢复密钥无法解包 DEK', async () => {
    const correct = await createRecoveryKey(new Uint8Array(32).fill(7))
    const wrong = await createRecoveryKey(new Uint8Array(32).fill(8))
    const text = await encryptBackupPayload(payload, correct, 'snapshot-2')
    await expect(decryptBackupPayload(text, wrong)).rejects.toThrow('恢复密钥与备份不匹配')
  })

  it('拒绝空恢复密钥', async () => {
    await expect(encryptBackupPayload(payload, '   ', 'snapshot-3')).rejects.toThrow('恢复密钥格式不正确')
  })
})
