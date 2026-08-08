import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'
import type { WebDavConfig } from '../services/webdav'

let privateStore: PrivateStoreV1 = { schema: 1 }
let publicConfig: Record<string, unknown> | null = null

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(privateStore)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    const draft = structuredClone(privateStore)
    mutator(draft)
    privateStore = draft
    return structuredClone(privateStore)
  }),
}))

vi.mock('../core/storage', () => ({
  STORAGE_KEYS: { WEBDAV_CONFIG: 'virtual:backup.webdav' },
  storageGet: vi.fn(async () => structuredClone(publicConfig)),
  storageSet: vi.fn(async (_key: string, value: Record<string, unknown>) => {
    publicConfig = structuredClone(value)
  }),
}))

vi.mock('../core/alarms', () => ({
  ALARM: { WEBDAV_BACKUP: 'webdav-backup' },
  reconfigureAlarm: vi.fn(async () => undefined),
}))

import { loadWebDavConfig, saveWebDavConfig } from '../services/webdav'

const config: WebDavConfig = {
  enabled: true,
  url: 'https://dav.example.com',
  path: '/MoviePilot',
  username: 'dav-user',
  password: 'dav-password',
  autoEnabled: true,
  intervalHours: 24,
  autoOnChange: false,
  retainCount: 5,
  contents: ['totp'],
}

describe('WebDAV Private Vault 存储', () => {
  beforeEach(() => {
    privateStore = { schema: 1 }
    publicConfig = null
  })

  it('URL、用户名和密码只写入 Private Store', async () => {
    await saveWebDavConfig(config)
    expect(privateStore.services?.webdav).toEqual({
      url: 'https://dav.example.com',
      username: 'dav-user',
      password: 'dav-password',
    })
    expect(publicConfig).not.toHaveProperty('url')
    expect(publicConfig).not.toHaveProperty('username')
    expect(publicConfig).not.toHaveProperty('password')
    expect(publicConfig).toMatchObject({ enabled: true, path: '/MoviePilot', intervalHours: 24 })
  })

  it('加载时组合 Public 调度配置和 Private 凭据', async () => {
    await saveWebDavConfig(config)
    await expect(loadWebDavConfig()).resolves.toEqual(config)
  })
})
