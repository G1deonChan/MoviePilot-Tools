import { describe, expect, it } from 'vitest'
import type { PrivateStoreV1, PublicStoreV1 } from '../core/storage-contracts'
import {
  MERGE_KEYS,
  RESTORE_CONFLICT_POLICY,
  compactPrivateStore,
  compactPublicStore,
  compactValue,
  pruneCache,
  stableStringify,
} from '../core/storage-policy'

describe('存储精简策略', () => {
  it('删除空值、空容器并裁剪与默认值相同的字段', () => {
    const input = {
      empty: '',
      blank: '   ',
      array: [],
      object: {},
      enabled: false,
      nested: { name: '  MoviePilot  ', password: '  keep spaces  ' },
    }
    expect(compactValue(input, { enabled: false })).toEqual({
      nested: { name: 'MoviePilot', password: '  keep spaces  ' },
    })
  })

  it('Public Store 仅剩 schema 时删除整个文档', () => {
    expect(compactPublicStore({ schema: 1 })).toBeNull()
    const store: PublicStoreV1 = { schema: 1, ui: { theme: 'dark', floatPositions: {} } }
    expect(compactPublicStore(store)).toEqual({ schema: 1, ui: { theme: 'dark' } })
  })

  it('Private Store 删除空领域但保留敏感字符串原始空白', () => {
    const store: PrivateStoreV1 = {
      schema: 1,
      services: {
        aiToken: '  token-value  ',
        webdav: { url: '', username: '', password: '' },
      },

      vault: { credentials: [], totp: [] },
    }
    expect(compactPrivateStore(store)).toEqual({
      schema: 1,
      services: { aiToken: '  token-value  ' },
    })
  })

  it('稳定序列化不受对象键顺序影响', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })

  it('缓存删除过期项并限制容量', () => {
    expect(
      pruneCache(
        {
          schema: 1,
          entries: {
            expired: { value: 1, expiresAt: 99 },
            active: { value: 2, expiresAt: 101 },
          },
        },
        100,
      ),
    ).toEqual({ schema: 1, entries: { active: { value: 2, expiresAt: 101 } } })
  })
})

describe('恢复合并契约', () => {
  it('固定领域主键与冲突规则', () => {
    expect(MERGE_KEYS.credentials).toBe('normalizedDomain+normalizedUsername')
    expect(MERGE_KEYS.totp).toBe('id|normalizedName')
    expect(RESTORE_CONFLICT_POLICY.credentials).toBe('newer-updatedAt')
    expect(RESTORE_CONFLICT_POLICY.publicSettings).toBe('replace-only')
    expect(RESTORE_CONFLICT_POLICY.webdavSettings).toBe('replace-only')
  })
})
