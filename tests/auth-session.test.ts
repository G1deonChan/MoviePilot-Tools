import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'

let store: PrivateStoreV1 = { schema: 1 }

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(store)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    const draft = structuredClone(store)
    mutator(draft)
    store = draft
    return structuredClone(store)
  }),
}))

import {
  clearActiveSession,
  getActiveBaseUrl,
  getActiveLoginUsername,
  getActiveToken,
  getActiveUserInfo,
} from '../core/auth-session'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'

const ACCOUNT_ID = 'account-1'

async function seedAuth(sessionAccountId = ACCOUNT_ID): Promise<void> {
  await updatePrivateStore((draft) => {
    draft.auth = {
      accounts: [
        {
          id: ACCOUNT_ID,
          label: 'server.test · user',
          baseURL: 'https://server.test',
          username: 'user',
          password: 'secret',
          createdAt: 1,
        },
      ],
      activeAccountId: ACCOUNT_ID,
      session: {
        accountId: sessionAccountId,
        token: 'Bearer token-value',
        userInfo: { name: 'profile-name' },
        issuedAt: 2,
      },
    }
  })
}

describe('核心认证会话', () => {
  beforeEach(() => {
    store = { schema: 1 }
  })

  it('读取当前账号和匹配会话', async () => {
    await seedAuth()

    await expect(getActiveBaseUrl()).resolves.toBe('https://server.test')
    await expect(getActiveLoginUsername()).resolves.toBe('user')
    await expect(getActiveToken()).resolves.toBe('token-value')
    await expect(getActiveUserInfo()).resolves.toEqual({ name: 'profile-name' })
  })

  it('会话账号不匹配时不返回 Token 和用户档案', async () => {
    await seedAuth('other-account')

    await expect(getActiveToken()).resolves.toBeNull()
    await expect(getActiveUserInfo()).resolves.toBeNull()
    await expect(getActiveBaseUrl()).resolves.toBe('https://server.test')
  })

  it('只清理当前会话并保留账号密码', async () => {
    await seedAuth()
    await clearActiveSession()

    const current = await getPrivateStore()
    expect(current.auth?.session).toBeUndefined()
    expect(current.auth?.accounts[0]?.password).toBe('secret')
    expect(current.auth?.activeAccountId).toBe(ACCOUNT_ID)
  })
})
