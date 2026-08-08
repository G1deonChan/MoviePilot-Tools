import { describe, expect, it } from 'vitest'
import {
  createRecoveryKey,
  createRecoveryKeyFile,
  parseRecoveryKey,
  parseRecoveryKeyFile,
  recoveryKeyFileName,
} from '../services/backup-key'

describe('MPT2-RK1 恢复密钥', () => {
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)

  it('固定根密钥生成稳定文本并可解析', async () => {
    const text = await createRecoveryKey(rootKey)
    expect(text).toBe(
      'MPT2-RK1.ae216c2ef5247a37.AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
    )
    const parsed = await parseRecoveryKey(text)
    expect(parsed.keyId).toBe('ae216c2ef5247a37')
    expect([...parsed.rootKey]).toEqual([...rootKey])
  })

  it('拒绝旧前缀、错误长度和错误 keyId', async () => {
    await expect(
      parseRecoveryKey('MPT2-BK1.ae216c2ef5247a37.AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA'),
    ).rejects.toThrow('恢复密钥格式不正确')
    await expect(parseRecoveryKey('MPT2-RK1.0000000000000000.AQID')).rejects.toThrow(
      '恢复根密钥长度必须为 32 字节',
    )
    await expect(
      parseRecoveryKey('MPT2-RK1.0000000000000000.AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA'),
    ).rejects.toThrow('恢复密钥校验失败')
  })

  it('mpkey 文件可稳定导出并重新导入', async () => {
    const recoveryKey = await createRecoveryKey(rootKey)
    const content = await createRecoveryKeyFile(recoveryKey, '2026-07-25T12:00:00.000Z')
    const parsed = await parseRecoveryKeyFile(content)
    expect(parsed).toEqual({ recoveryKey, keyId: 'ae216c2ef5247a37' })
    expect(JSON.parse(content)).toMatchObject({
      format: 'moviepilot-tools-recovery-key',
      version: 1,
      keyId: 'ae216c2ef5247a37',
      createdAt: '2026-07-25T12:00:00.000Z',
    })
    expect(recoveryKeyFileName('ae216c2ef5247a37', new Date('2026-07-25T00:00:00.000Z')))
      .toBe('MoviePilot-Tools-Recovery-ae216c2ef5247a37-20260725.mpkey')
  })

  it('拒绝错误格式、版本和被篡改的 mpkey', async () => {
    await expect(parseRecoveryKeyFile('{}')).rejects.toThrow('不支持的恢复密钥文件')
    await expect(parseRecoveryKeyFile(JSON.stringify({
      format: 'moviepilot-tools-recovery-key',
      version: 2,
    }))).rejects.toThrow('不支持的恢复密钥文件')

    const recoveryKey = await createRecoveryKey(rootKey)
    const content = JSON.parse(await createRecoveryKeyFile(recoveryKey))
    content.keyId = '0000000000000000'
    await expect(parseRecoveryKeyFile(JSON.stringify(content))).rejects.toThrow('恢复密钥文件校验失败')
  })
})
