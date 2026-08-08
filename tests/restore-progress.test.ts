import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupProgress } from '../services/backup-schema'

const mocks = vi.hoisted(() => ({
  getPrivateStore: vi.fn(async () => ({ schema: 1 })),
  getPublicStore: vi.fn(async () => ({ schema: 1 })),
  updatePrivateStore: vi.fn(async (mutator: (draft: Record<string, unknown>) => void) => {
    const draft: Record<string, unknown> = { schema: 1 }
    mutator(draft)
    return draft
  }),
  updatePublicStore: vi.fn(async (mutator: (draft: Record<string, unknown>) => void) => {
    const draft: Record<string, unknown> = { schema: 1 }
    mutator(draft)
    return draft
  }),
  loadBackupKey: vi.fn(async () => 'recovery-key'),
  decryptBackupPayload: vi.fn(async () => ({
    schema: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    data: { ocrCorrections: { O: '0' } },
  })),
  sha256HexBytes: vi.fn(async () => 'a'.repeat(64)),
}))

vi.mock('../core/private-vault', () => ({
  getPrivateStore: mocks.getPrivateStore,
  updatePrivateStore: mocks.updatePrivateStore,
}))

vi.mock('../core/store-repository', () => ({
  getPublicStore: mocks.getPublicStore,
  updatePublicStore: mocks.updatePublicStore,
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
  encryptBackupPayload: vi.fn(),
  decryptBackupPayload: mocks.decryptBackupPayload,
}))

vi.mock('../core/crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/crypto')>()
  return { ...original, sha256HexBytes: mocks.sha256HexBytes }
})

import { MP_CHUNK_BYTES, downloadLargeBytesFromMp } from '../core/mp-backend'
import { restoreSnapshotFile, type BackupSnapshotFile, type BackupSnapshotManifest } from '../services/backup-snapshot'

function chunkResponse(content: Uint8Array, nextOffset: number, total: number, done: boolean) {
  let binary = ''
  for (const byte of content) binary += String.fromCharCode(byte)
  return {
    ok: true,
    status: 200,
    data: {
      data: {
        content: btoa(binary),
        next_offset: nextOffset,
        total,
        done,
      },
    },
  }
}

describe('还原进度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('MoviePilot 分片下载报告真实字节和分片', async () => {
    const total = MP_CHUNK_BYTES + 9
    const get = vi.fn()
      .mockResolvedValueOnce(chunkResponse(new Uint8Array(MP_CHUNK_BYTES), MP_CHUNK_BYTES, total, false))
      .mockResolvedValueOnce(chunkResponse(new Uint8Array(9), total, total, true))
    const http = await import('../core/http')
    vi.spyOn(http.api, 'get').mockImplementation(get)
    const progress: Array<{ transferredBytes: number; totalBytes: number; chunkIndex: number; chunkCount: number }> = []

    const result = await downloadLargeBytesFromMp('user/backups/backup.mpt2', (value) => progress.push(value))

    expect(result?.byteLength).toBe(total)
    expect(progress).toEqual([
      { transferredBytes: MP_CHUNK_BYTES, totalBytes: total, chunkIndex: 1, chunkCount: 2 },
      { transferredBytes: total, totalBytes: total, chunkIndex: 2, chunkCount: 2 },
    ])
  })

  it('还原文件按校验、解密、恢复和完成顺序报告阶段', async () => {
    const data = new TextEncoder().encode('{"encrypted":true}') as Uint8Array<ArrayBuffer>
    const file: BackupSnapshotFile = {
      name: 'backup.mpt2',
      type: 'encrypted',
      size: data.byteLength,
      contentType: 'application/octet-stream',
      data,
      content: new TextDecoder().decode(data),
    }
    const manifest: BackupSnapshotManifest = {
      format: 'mpt2-backup-manifest',
      version: 1,
      id: '20260723T000000000Z',
      createdAt: '2026-07-23T00:00:00.000Z',
      appVersion: '2.0.0',
      keyId: 'key-id',
      size: data.byteLength,
      sha256: 'a'.repeat(64),
      contents: ['ocrCorrections'],
      files: [{ name: 'backup.mpt2', type: 'encrypted', size: data.byteLength }],
    }
    const progress: BackupProgress[] = []

    await restoreSnapshotFile(file, ['ocrCorrections'], 'replace', manifest, (value) => progress.push(value))

    expect(progress.map((item) => [item.phase, item.percent])).toEqual([
      ['verifying', 58],
      ['decrypting', 68],
      ['verifying', 74],
      ['restoring', 78],
      ['restoring', 90],
      ['restoring', 95],
      ['completed', 100],
    ])
  })
})
