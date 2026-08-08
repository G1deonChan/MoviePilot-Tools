import { describe, expect, it } from 'vitest'
import {
  createBackupId,
  parseBackupManifest,
  snapshotSummary,
  type BackupSnapshotManifest,
} from '../services/backup-snapshot'

describe('单容器备份快照', () => {
  it('生成紧凑且可排序的 UTC 快照目录名', () => {
    expect(createBackupId(new Date('2026-07-20T12:34:56.789Z'))).toBe('20260720T123456789Z')
  })

  it('manifest 只声明唯一加密容器和逻辑内容', () => {
    const manifest: BackupSnapshotManifest = {
      format: 'mpt2-backup-manifest',
      version: 1,
      id: '20260720T123456789Z',
      createdAt: '2026-07-20T12:34:56.789Z',
      appVersion: '2.0.0',
      keyId: '0011223344556677',
      size: 1024,
      sha256: 'a'.repeat(64),
      contents: ['totp', 'iconPack'],
      files: [{ name: 'backup.mpt2', type: 'encrypted', size: 1024 }],
    }
    const parsed = parseBackupManifest(JSON.stringify(manifest))
    const summary = snapshotSummary(parsed, `${manifest.id}/manifest.json`)

    expect(parsed.files).toEqual([{ name: 'backup.mpt2', type: 'encrypted', size: 1024 }])
    expect(summary.manifestName).toBe('20260720T123456789Z/manifest.json')
    expect(summary.contents).toEqual(['totp', 'iconPack'])
  })

  it('拒绝旧分文件清单', () => {
    expect(() => parseBackupManifest(JSON.stringify({
      type: 'moviepilot-tools-backup-set',
      version: 1,
      id: 'backup-test',
      createdAt: '2026-07-20T00:00:00.000Z',
      files: { totp: 'totp.json' },
    }))).toThrow('备份清单格式不正确')
  })
})
