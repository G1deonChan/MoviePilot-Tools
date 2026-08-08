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

vi.mock('../core/http', () => ({
  api: { get: vi.fn(async () => ({ ok: true })) },
  registerTokenRefreshHandler: vi.fn(),
}))

import { listAccounts } from '../services/auth'

function userInfo(userID: number, userName: string) {
  return {
    superUser: true,
    userID,
    userName,
    avatar: '',
    level: 2,
    permissions: {},
    wizard: false,
  }
}

describe('多管理员账号展示', () => {
  beforeEach(() => {
    store = {
      schema: 1,
      auth: {
        activeAccountId: 'account-2',
        accounts: [
          {
            id: 'account-1', label: '管理员一', baseURL: 'http://192.168.1.10:3000',
            username: 'admin', password: 'one', userInfo: userInfo(1, '管理员一'), createdAt: 1,
          },
          {
            id: 'account-2', label: '管理员二', baseURL: 'http://192.168.1.20:3000',
            username: 'admin', password: 'two', userInfo: userInfo(2, '管理员二'), createdAt: 2,
          },
        ],
        session: {
          accountId: 'account-2', token: 'token', userInfo: userInfo(2, '管理员二'), updatedAt: 3,
        },
      },
    }
  })

  it('同用户名的不同服务器管理员账号均独立显示', async () => {
    const accounts = await listAccounts()
    expect(accounts).toHaveLength(2)
    expect(accounts.map((item) => item.userName)).toEqual(['管理员一', '管理员二'])
    expect(accounts.every((item) => item.superUser)).toBe(true)
    expect(accounts.find((item) => item.id === 'account-1')?.isActive).toBe(false)
    expect(accounts.find((item) => item.id === 'account-2')?.isActive).toBe(true)
  })
})
