import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  privateStore: {
    schema: 1,
    services: {
      webdav: {
        url: 'https://dav.example.com',
        username: 'dav-user',
        password: 'dav-password',
      },
    },
  } as Record<string, unknown>,
  publicStore: {
    schema: 1,
    backup: {
      webdav: {
        enabled: true,
        path: '/MoviePilot',
        autoEnabled: true,
        intervalHours: 12,
        autoOnChange: true,
        retainCount: 7,
        contents: ['totp', 'credentials'],
      },
    },
  } as Record<string, unknown>,
  encryptedPayload: null as Record<string, unknown> | null,
  updatePrivateStore: vi.fn(),
  updatePublicStore: vi.fn(),
  reconfigureAlarm: vi.fn(),
}))

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(mocks.privateStore)),
  updatePrivateStore: mocks.updatePrivateStore,
}))
vi.mock('../core/store-repository', () => ({
  getPublicStore: vi.fn(async () => structuredClone(mocks.publicStore)),
  updatePublicStore: mocks.updatePublicStore,
}))
vi.mock('../core/asset-repository', () => ({
  exportBackgroundAsset: vi.fn(async () => null), clearBackgroundAsset: vi.fn(), saveBackgroundAsset: vi.fn(),
}))
vi.mock('../services/site-icon-pack', () => ({
  exportIconPackZip: vi.fn(async () => null), clearIconPack: vi.fn(), importIconPackFromZip: vi.fn(),
}))
vi.mock('../services/ocr-runtime', () => ({
  exportOcrOfflinePackZip: vi.fn(async () => null), clearOcrRuntime: vi.fn(), importOcrOfflinePack: vi.fn(),
}))
vi.mock('../services/backup-key', () => ({ loadBackupKey: vi.fn(async () => 'MPT2-RK1.0000000000000000.key') }))
vi.mock('../services/backup-envelope', () => ({
  encryptBackupPayload: vi.fn(async (payload: Record<string, unknown>) => {
    mocks.encryptedPayload = structuredClone(payload)
    return '{"encrypted":true}'
  }),
  decryptBackupPayload: vi.fn(),
}))
vi.mock('../core/crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/crypto')>()
  return { ...original, sha256HexBytes: vi.fn(async () => 'a'.repeat(64)) }
})
vi.mock('../core/alarms', () => ({
  ALARM: { WEBDAV_BACKUP: 'webdav-backup' },
  reconfigureAlarm: mocks.reconfigureAlarm,
}))

import { buildBackupSnapshot, applyPreparedRestore } from '../services/backup-snapshot'
import type { BackupPayloadV1 } from '../services/backup-schema'

const webdavSettings = {
  enabled: true,
  url: 'https://dav.example.com',
  path: '/MoviePilot',
  username: 'dav-user',
  password: 'dav-password',
  autoEnabled: true,
  intervalHours: 12,
  autoOnChange: true,
  retainCount: 7,
  contents: ['totp', 'credentials'] as const,
}

describe('MoviePilot 备份 WebDAV 设置', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.0.0')
    vi.clearAllMocks()
    mocks.encryptedPayload = null
    mocks.updatePrivateStore.mockImplementation(async (mutator: (draft: Record<string, unknown>) => void) => {
      const draft = structuredClone(mocks.privateStore)
      mutator(draft)
      return draft
    })
    mocks.updatePublicStore.mockImplementation(async (mutator: (draft: Record<string, unknown>) => void) => {
      const draft = structuredClone(mocks.publicStore)
      mutator(draft)
      return draft
    })
  })

  it('勾选后将 WebDAV 连接和调度设置写入加密 payload', async () => {
    const snapshot = await buildBackupSnapshot(['webdavSettings'])
    const payload = mocks.encryptedPayload as BackupPayloadV1
    expect(payload.data?.webdavSettings).toEqual(webdavSettings)
    expect(snapshot.manifest.contents).toEqual(['webdavSettings'])
  })

  it('远程恢复时同时写回私有凭据、公共参数并重建闹钟', async () => {
    await applyPreparedRestore({
      payload: { schema: 1, createdAt: '2026-07-24T00:00:00.000Z', data: { webdavSettings } },
      selected: ['webdavSettings'],
      assets: [],
    })

    const privateDraft: Record<string, unknown> = { schema: 1 }
    const publicDraft: Record<string, unknown> = { schema: 1 }
    const privateMutator = mocks.updatePrivateStore.mock.calls.find((call) => {
      const draft: Record<string, unknown> = { schema: 1 }
      call[0](draft)
      return 'services' in draft
    })?.[0]
    const publicMutator = mocks.updatePublicStore.mock.calls.find((call) => {
      const draft: Record<string, unknown> = { schema: 1 }
      call[0](draft)
      return 'backup' in draft
    })?.[0]
    privateMutator(privateDraft)
    publicMutator(publicDraft)

    expect(privateDraft).toMatchObject({
      services: { webdav: { url: webdavSettings.url, username: webdavSettings.username, password: webdavSettings.password } },
    })
    expect(publicDraft).toMatchObject({ backup: { webdav: { path: '/MoviePilot', intervalHours: 12, retainCount: 7 } } })
    expect(mocks.reconfigureAlarm).toHaveBeenCalledWith('webdav-backup', true, 720)
  })
})
