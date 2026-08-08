import { describe, expect, it } from 'vitest'
import type { StorageItemKey } from 'wxt/storage'
import { STORE_KEYS, StoreRepository, type StoreDriver } from '../core/store-repository'

class MemoryDriver implements StoreDriver {
  readonly values = new Map<StorageItemKey, unknown>()
  writes = 0

  async get<T>(key: StorageItemKey): Promise<T | null> {
    return (structuredClone(this.values.get(key)) as T | undefined) ?? null
  }

  async set<T>(key: StorageItemKey, value: T): Promise<void> {
    this.writes += 1
    this.values.set(key, structuredClone(value))
  }

  async remove(key: StorageItemKey): Promise<void> {
    this.values.delete(key)
  }

  async snapshot(area: 'local' | 'session'): Promise<Record<string, unknown>> {
    const prefix = `${area}:`
    return Object.fromEntries(
      [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), structuredClone(value)]),
    )
  }
}

describe('五键 Store Repository', () => {
  it('Public Store 删除空字段且相同值不重复写入', async () => {
    const driver = new MemoryDriver()
    const repository = new StoreRepository(driver)

    await repository.updatePublicStore((draft) => {
      draft.ui = { theme: ' dark ', floatPositions: {} }
    })
    expect(await repository.getPublicStore()).toEqual({ schema: 1, ui: { theme: 'dark' } })
    expect(driver.writes).toBe(1)

    await repository.updatePublicStore((draft) => {
      draft.ui = { theme: 'dark' }
    })
    expect(driver.writes).toBe(1)
  })

  it('并发更新由单写队列串行合并', async () => {
    const driver = new MemoryDriver()
    const repository = new StoreRepository(driver)
    await Promise.all([
      repository.updatePublicStore(async (draft) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        draft.ui = { theme: 'dark' }
      }),
      repository.updatePublicStore((draft) => {
        draft.credentials = { autofill: true }
      }),
    ])
    expect(await repository.getPublicStore()).toEqual({
      schema: 1,
      credentials: { autofill: true },
      ui: { theme: 'dark' },
    })
  })

  it('缓存支持 TTL、过期删除与整体清空', async () => {
    const driver = new MemoryDriver()
    const repository = new StoreRepository(driver)
    await repository.setCache('version', { tag: 'v2' }, 60_000)
    expect(await repository.getCache('version')).toEqual({ tag: 'v2' })

    const cache = driver.values.get(STORE_KEYS.CACHE) as {
      entries: Record<string, { value: unknown; expiresAt: number }>
    }
    cache.entries.version.expiresAt = 1
    driver.values.set(STORE_KEYS.CACHE, cache)
    expect(await repository.getCache('version', 2)).toBeNull()
    expect(driver.values.has(STORE_KEYS.CACHE)).toBe(false)
  })

  it('旧命名空间重置只删除 mp_ 键和指定旧数据库', async () => {
    const driver = new MemoryDriver()
    driver.values.set('local:mp_token', 'legacy')
    driver.values.set('session:mp_pin_session_master', 'legacy')
    driver.values.set(STORE_KEYS.PUBLIC, { schema: 1, ui: { theme: 'dark' } })
    driver.values.set('local:other-extension', 'keep')
    const deletedDatabases: string[] = []

    const repository = new StoreRepository(driver)
    await repository.setDeviceStore({
      schema: 1,
      deviceId: 'device',
      rootKey: 'root',
      createdAt: '2026-07-22T00:00:00.000Z',
    })
    await repository.resetLegacyNamespace(async (name) => {
      deletedDatabases.push(name)
    })
    await repository.resetLegacyNamespace(async (name) => {
      deletedDatabases.push(`repeat:${name}`)
    })

    expect(driver.values.has('local:mp_token')).toBe(false)
    expect(driver.values.has('session:mp_pin_session_master')).toBe(false)
    expect(driver.values.has(STORE_KEYS.PUBLIC)).toBe(true)
    expect(driver.values.get('local:other-extension')).toBe('keep')
    expect(deletedDatabases).toEqual(['mp_site_icons', 'mp_ocr_v1', 'mp-page-file-picker'])
    expect((await repository.getDeviceStore())?.namespaceResetAt).toBeTruthy()

  })

  it('清空新存储仅移除五个顶层键', async () => {
    const driver = new MemoryDriver()
    const repository = new StoreRepository(driver)
    for (const key of Object.values(STORE_KEYS)) driver.values.set(key, { value: key })
    driver.values.set('local:other-extension', 'keep')

    await repository.clearAllStores()

    for (const key of Object.values(STORE_KEYS)) expect(driver.values.has(key)).toBe(false)
    expect(driver.values.get('local:other-extension')).toBe('keep')
  })
})
