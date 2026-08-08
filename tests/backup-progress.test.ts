import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getPrivateStore: vi.fn(async () => ({ schema: 1 })),
  getPublicStore: vi.fn(async () => ({ schema: 1 })),
  loadBackupKey: vi.fn(async () => 'MPT2-RK1.0000000000000000.key'),
  encryptBackupPayload: vi.fn(async () => '{"encrypted":true}'),
  sha256HexBytes: vi.fn(async () => 'a'.repeat(64)),
}))

vi.mock('../core/http', () => ({
  api: { post: mocks.post },
}))

vi.mock('../core/auth-session', () => ({
  getActiveLoginUsername: vi.fn(async () => 'user'),
  getActiveUserInfo: vi.fn(async () => null),
}))

vi.mock('../core/private-vault', () => ({
  getPrivateStore: mocks.getPrivateStore,
  updatePrivateStore: vi.fn(),
}))

vi.mock('../core/store-repository', () => ({
  getPublicStore: mocks.getPublicStore,
  updatePublicStore: vi.fn(),
}))

vi.mock('../core/asset-repository', () => ({
  exportBackgroundAsset: vi.fn(async () => null),
  clearBackgroundAsset: vi.fn(),
  saveBackgroundAsset: vi.fn(),
}))

vi.mock('../services/site-icon-pack', () => ({
  exportIconPackZip: vi.fn(async () => null),
  clearIconPack: vi.fn(),
  importIconPackFromZip: vi.fn(),
}))

vi.mock('../services/ocr-runtime', () => ({
  exportOcrOfflinePackZip: vi.fn(async () => null),
  clearOcrRuntime: vi.fn(),
  importOcrOfflinePack: vi.fn(),
}))

vi.mock('../services/backup-key', () => ({
  loadBackupKey: mocks.loadBackupKey,
}))

vi.mock('../services/backup-envelope', () => ({
  encryptBackupPayload: mocks.encryptBackupPayload,
  decryptBackupPayload: vi.fn(),
}))

vi.mock('../core/crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/crypto')>()
  return { ...original, sha256HexBytes: mocks.sha256HexBytes }
})

import { MP_CHUNK_BYTES, uploadLargeBytesToMp } from '../core/mp-backend'
import { buildBackupSnapshot } from '../services/backup-snapshot'

describe('备份进度', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.0.0')
    vi.clearAllMocks()
    mocks.post.mockResolvedValue({ ok: true, status: 200, data: { data: {} } })
  })

  it('MoviePilot 分片上传按成功分片报告真实字节', async () => {
    const bytes = new Uint8Array(MP_CHUNK_BYTES * 2 + 17)
    const progress: Array<{
      transferredBytes: number
      totalBytes: number
      chunkIndex: number
      chunkCount: number
    }> = []

    const result = await uploadLargeBytesToMp('user/backups/file.mpt2', bytes, 1, (value) => {
      progress.push(value)
    })

    expect(result.ok).toBe(true)
    expect(progress).toHaveLength(3)
    expect(progress[0]).toEqual({
      transferredBytes: MP_CHUNK_BYTES,
      totalBytes: bytes.byteLength,
      chunkIndex: 1,
      chunkCount: 3,
    })
    expect(progress.at(-1)).toEqual({
      transferredBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      chunkIndex: 3,
      chunkCount: 3,
    })
  })

  it('快照构建按顺序报告校验、收集和打包阶段', async () => {
    const progress: Array<{ phase: string; percent: number }> = []

    await buildBackupSnapshot(['publicSettings'], (value) => {
      progress.push({ phase: value.phase, percent: value.percent })
    })

    expect(progress).toEqual([
      { phase: 'validating', percent: 2 },
      { phase: 'collecting', percent: 8 },
      { phase: 'packing', percent: 28 },
      { phase: 'packing', percent: 36 },
      { phase: 'packing', percent: 40 },
    ])
  })
})
