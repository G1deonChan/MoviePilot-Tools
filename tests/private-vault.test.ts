import { describe, expect, it } from 'vitest'
import type { StorageItemKey } from 'wxt/storage'
import { PrivateVault } from '../core/private-vault'
import { STORE_KEYS, StoreRepository, type StoreDriver } from '../core/store-repository'

class MemoryDriver implements StoreDriver {
  readonly values = new Map<StorageItemKey, unknown>()

  async get<T>(key: StorageItemKey): Promise<T | null> {
    return (structuredClone(this.values.get(key)) as T | undefined) ?? null
  }

  async set<T>(key: StorageItemKey, value: T): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  async remove(key: StorageItemKey): Promise<void> {
    this.values.delete(key)
  }

  async snapshot(): Promise<Record<string, unknown>> {
    return {}
  }
}

describe('Private Vault Repository', () => {
  it('首次写入创建设备根密钥且本地只保存信封', async () => {
    const driver = new MemoryDriver()
    const vault = new PrivateVault(new StoreRepository(driver))
    await vault.update((draft) => {
      draft.services = { aiToken: 'token-value' }
    })

    expect(driver.values.has(STORE_KEYS.DEVICE)).toBe(true)
    const envelope = driver.values.get(STORE_KEYS.PRIVATE) as { format: string; payload: { ciphertext: string } }
    expect(envelope.format).toBe('mpt2-local-vault')
    expect(JSON.stringify(envelope)).not.toContain('token-value')
    expect(await vault.get()).toEqual({ schema: 1, services: { aiToken: 'token-value' } })
  })

  it('并发更新串行合并且清空后删除私有键', async () => {
    const driver = new MemoryDriver()
    const vault = new PrivateVault(new StoreRepository(driver))
    await Promise.all([
      vault.update(async (draft) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        draft.services = { aiToken: 'token' }
      }),
      vault.update((draft) => {
        draft.backup = { rootKey: 'root', keyId: 'key' }
      }),
    ])
    expect(await vault.get()).toEqual({
      schema: 1,
      backup: { keyId: 'key', rootKey: 'root' },
      services: { aiToken: 'token' },
    })

    await vault.clear()
    expect(driver.values.has(STORE_KEYS.PRIVATE)).toBe(false)
    expect(await vault.get()).toEqual({ schema: 1 })
  })

  it('损坏信封直接失败，不当作明文读取', async () => {
    const driver = new MemoryDriver()
    const repository = new StoreRepository(driver)
    const vault = new PrivateVault(repository)
    driver.values.set(STORE_KEYS.PRIVATE, { schema: 1, services: { aiToken: 'plaintext' } })
    await expect(vault.get()).rejects.toThrow('本地私有仓格式不受支持')
  })
})
