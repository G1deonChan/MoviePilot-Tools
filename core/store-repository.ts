import { storage, type StorageItemKey } from 'wxt/storage'
import type {
  AssetsStoreV1,
  CacheEntry,
  CacheStoreV1,
  DeviceStoreV1,
  LocalVaultEnvelopeV1,
  PublicStoreV1,
} from './storage-contracts'
import {
  DEFAULT_CACHE_TTL_MS,
  compactPublicStore,
  compactValue,
  pruneCache,
  stableStringify,
} from './storage-policy'

export const STORE_KEYS = {
  PUBLIC: 'local:mpt2.public',
  PRIVATE: 'local:mpt2.private',
  DEVICE: 'local:mpt2.device',
  ASSETS: 'local:mpt2.assets',
  CACHE: 'local:mpt2.cache',
} as const satisfies Record<string, StorageItemKey>

export const STORE_KEY_LIST = Object.freeze(Object.values(STORE_KEYS))

export interface StoreDriver {
  get<T>(key: StorageItemKey): Promise<T | null>
  set<T>(key: StorageItemKey, value: T): Promise<void>
  remove(key: StorageItemKey): Promise<void>
  snapshot(area: 'local' | 'session'): Promise<Record<string, unknown>>
}

const wxtDriver: StoreDriver = {
  get: <T>(key: StorageItemKey) => storage.getItem<T>(key),
  set: <T>(key: StorageItemKey, value: T) => storage.setItem(key, value),
  remove: (key: StorageItemKey) => storage.removeItem(key),
  snapshot: (area: 'local' | 'session') => storage.snapshot(area),
}

type StoreMutator<T> = (draft: T) => void | T | Promise<void | T>
type StoreCompactor<T> = (store: T) => T | null

function clone<T>(value: T): T {
  return structuredClone(value)
}

function serialize(value: unknown): string {
  return stableStringify(value)
}

export class StoreRepository {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly driver: StoreDriver = wxtDriver) {}

  getPublicStore(): Promise<PublicStoreV1> {
    return this.readDocument(STORE_KEYS.PUBLIC, { schema: 1 })
  }

  updatePublicStore(mutator: StoreMutator<PublicStoreV1>): Promise<PublicStoreV1> {
    return this.updateDocument(STORE_KEYS.PUBLIC, { schema: 1 }, mutator, compactPublicStore)
  }

  getDeviceStore(): Promise<DeviceStoreV1 | null> {
    return this.driver.get<DeviceStoreV1>(STORE_KEYS.DEVICE)
  }

  setDeviceStore(store: DeviceStoreV1): Promise<void> {
    return this.enqueue(async () => {
      const compacted = compactValue(store)
      if (!compacted) throw new Error('设备存储不能为空')
      await this.writeIfChanged(STORE_KEYS.DEVICE, compacted)
    })
  }

  getPrivateEnvelope(): Promise<LocalVaultEnvelopeV1 | null> {
    return this.driver.get<LocalVaultEnvelopeV1>(STORE_KEYS.PRIVATE)
  }

  setPrivateEnvelope(envelope: LocalVaultEnvelopeV1 | null): Promise<void> {
    return this.enqueue(async () => {
      if (!envelope) {
        await this.driver.remove(STORE_KEYS.PRIVATE)
        return
      }
      await this.writeIfChanged(STORE_KEYS.PRIVATE, envelope)
    })
  }

  getAssetsStore(): Promise<AssetsStoreV1> {
    return this.readDocument(STORE_KEYS.ASSETS, { schema: 1 })
  }

  updateAssetsStore(mutator: StoreMutator<AssetsStoreV1>): Promise<AssetsStoreV1> {
    return this.updateDocument(
      STORE_KEYS.ASSETS,
      { schema: 1 },
      mutator,
      (store) => {
        const compacted = compactValue(store, { schema: 1 }) as AssetsStoreV1 | undefined
        return compacted && Object.keys(compacted).some((key) => key !== 'schema')
          ? { ...compacted, schema: 1 }
          : null
      },
    )
  }

  async getCache<T>(key: string, now = Date.now()): Promise<T | null> {
    const store = await this.driver.get<CacheStoreV1>(STORE_KEYS.CACHE)
    const entry = store?.entries?.[key]
    if (!entry) return null
    if (entry.expiresAt <= now) {
      await this.removeCache(key)
      return null
    }
    return entry.value as T
  }

  setCache<T>(key: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    if (!key.trim()) return Promise.reject(new Error('缓存键不能为空'))
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return Promise.reject(new Error('缓存 TTL 必须大于 0'))
    return this.enqueue(async () => {
      const current = (await this.driver.get<CacheStoreV1>(STORE_KEYS.CACHE)) || { schema: 1 }
      const entries: Record<string, CacheEntry> = {
        ...(current.entries || {}),
        [key]: { value, expiresAt: Date.now() + ttlMs },
      }
      const compacted = pruneCache({ schema: 1, entries })
      if (!compacted) await this.driver.remove(STORE_KEYS.CACHE)
      else await this.writeIfChanged(STORE_KEYS.CACHE, compacted)
    })
  }

  removeCache(key: string): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.driver.get<CacheStoreV1>(STORE_KEYS.CACHE)
      if (!current?.entries?.[key]) return
      const entries = { ...current.entries }
      delete entries[key]
      const compacted = pruneCache({ schema: 1, entries })
      if (!compacted) await this.driver.remove(STORE_KEYS.CACHE)
      else await this.writeIfChanged(STORE_KEYS.CACHE, compacted)
    })
  }

  clearCache(): Promise<void> {
    return this.enqueue(() => this.driver.remove(STORE_KEYS.CACHE))
  }

  clearAllStores(): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all(STORE_KEY_LIST.map((key) => this.driver.remove(key)))
    })
  }

  async resetLegacyNamespace(deleteDatabase: (name: string) => Promise<void>): Promise<void> {
    await this.enqueue(async () => {
      const device = await this.driver.get<DeviceStoreV1>(STORE_KEYS.DEVICE)
      if (device?.namespaceResetAt) return
      const [local, session] = await Promise.all([
        this.driver.snapshot('local'),
        this.driver.snapshot('session'),
      ])
      const legacyKeys = [
        ...Object.keys(local).filter((key) => key.startsWith('mp_')).map((key) => `local:${key}` as StorageItemKey),
        ...Object.keys(session)
          .filter((key) => key.startsWith('mp_'))
          .map((key) => `session:${key}` as StorageItemKey),
      ]
      await Promise.all(legacyKeys.map((key) => this.driver.remove(key)))
      await Promise.all(
        ['mp_site_icons', 'mp_ocr_v1', 'mp-page-file-picker'].map((name) => deleteDatabase(name)),
      )
      if (device) {
        await this.driver.set(STORE_KEYS.DEVICE, {
          ...device,
          namespaceResetAt: new Date().toISOString(),
        } satisfies DeviceStoreV1)
      }
    })
  }

  private async readDocument<T>(key: StorageItemKey, fallback: T): Promise<T> {
    const value = await this.driver.get<T>(key)
    return value ? clone(value) : clone(fallback)
  }

  private updateDocument<T>(
    key: StorageItemKey,
    fallback: T,
    mutator: StoreMutator<T>,
    compact: StoreCompactor<T>,
  ): Promise<T> {
    let result = clone(fallback)
    return this.enqueue(async () => {
      const current = await this.readDocument(key, fallback)
      const draft = clone(current)
      const returned = await mutator(draft)
      const next = compact((returned || draft) as T)
      if (!next) {
        await this.driver.remove(key)
        result = clone(fallback)
        return
      }
      await this.writeIfChanged<T>(key, next as T, current)
      result = clone(next as T)
    }).then(() => result)
  }

  private async writeIfChanged<T>(key: StorageItemKey, next: T, current?: T | null): Promise<void> {
    const existing = current === undefined ? await this.driver.get<T>(key) : current
    if (serialize(existing) === serialize(next)) return
    await this.driver.set(key, next)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error(`删除 IndexedDB 失败：${name}`))
    request.onblocked = () => reject(new Error(`IndexedDB 正在使用，无法删除：${name}`))
  })
}

export const storeRepository = new StoreRepository()

export const getPublicStore = () => storeRepository.getPublicStore()
export const updatePublicStore = (mutator: StoreMutator<PublicStoreV1>) =>
  storeRepository.updatePublicStore(mutator)
export const getAssetsStore = () => storeRepository.getAssetsStore()
export const updateAssetsStore = (mutator: StoreMutator<AssetsStoreV1>) =>
  storeRepository.updateAssetsStore(mutator)
export const clearCache = () => storeRepository.clearCache()
export const clearAllStores = () => storeRepository.clearAllStores()

export const resetLegacyNamespace = () => storeRepository.resetLegacyNamespace(deleteIndexedDb)
