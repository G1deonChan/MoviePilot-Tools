import { describe, expect, it } from 'vitest'
import { createRecoveryKey } from '../services/backup-key'
import { decryptBackupPayload, encryptBackupPayload } from '../services/backup-envelope'
import { prepareRestore, type BackupSnapshotFile, type BackupSnapshotManifest } from '../services/backup-snapshot'
import { sha256HexBytes } from '../core/crypto'
import type { BackupPayloadV1 } from '../services/backup-schema'

const payload: BackupPayloadV1 = {
  schema: 1,
  createdAt: '2026-07-22T00:00:00.000Z',
  data: { ocrCorrections: { O: '0' } },
}

async function fixture(): Promise<{
  key: string
  file: BackupSnapshotFile
  manifest: BackupSnapshotManifest
}> {
  const key = await createRecoveryKey(new Uint8Array(32).fill(5))
  const content = await encryptBackupPayload(payload, key, '20260722T000000000Z')
  const data = new TextEncoder().encode(content) as Uint8Array<ArrayBuffer>
  const manifest: BackupSnapshotManifest = {
    format: 'mpt2-backup-manifest', version: 1, id: '20260722T000000000Z',
    createdAt: payload.createdAt, appVersion: '2.0.0', keyId: key.split('.')[1],
    size: data.byteLength, sha256: await sha256HexBytes(data), contents: ['ocrCorrections'],
    files: [{ name: 'backup.mpt2', type: 'encrypted', size: data.byteLength }],
  }
  return {
    key,
    file: { name: 'backup.mpt2', type: 'encrypted', size: data.byteLength, content, data, contentType: 'application/octet-stream' },
    manifest,
  }
}

describe('跨设备恢复预校验', () => {
  it('截断容器无法解密', async () => {
    const { key, file } = await fixture()
    await expect(decryptBackupPayload(file.content.slice(0, -8), key)).rejects.toThrow()
  })

  it('manifest 大小不匹配时在写入前拒绝', async () => {
    const { file, manifest } = await fixture()
    await expect(prepareRestore(file, ['ocrCorrections'], { ...manifest, size: manifest.size + 1 })).rejects.toThrow('备份文件大小不匹配')
  })

  it('manifest SHA-256 不匹配时在写入前拒绝', async () => {
    const { file, manifest } = await fixture()
    await expect(prepareRestore(file, ['ocrCorrections'], { ...manifest, sha256: '0'.repeat(64) })).rejects.toThrow('备份文件 SHA-256 校验失败')
  })
})
