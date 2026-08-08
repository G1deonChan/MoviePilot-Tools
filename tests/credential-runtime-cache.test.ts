import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  privateStore: { schema: 1 } as Record<string, unknown>,
}))

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(mocks.privateStore)),
  updatePrivateStore: vi.fn(async () => structuredClone(mocks.privateStore)),
}))

vi.mock('../core/store-repository', () => ({
  getPublicStore: vi.fn(async () => ({ schema: 1 })),
  updatePublicStore: vi.fn(async () => ({ schema: 1 })),
}))

vi.mock('../core/pin-session', () => ({
  clearPinSessionUnlocked: vi.fn(async () => undefined),
  isPinSessionUnlocked: vi.fn(async () => false),
  markPinSessionUnlocked: vi.fn(async () => undefined),
}))

import { getCredentialByHost } from '../services/credential'

afterEach(() => {
  mocks.privateStore = { schema: 1 }
})

describe('后台凭据运行时读取', () => {
  it('后台曾读取空列表后仍能发现其他扩展上下文新保存的凭据', async () => {
    expect(await getCredentialByHost('zq.example-pt.test')).toBeNull()

    mocks.privateStore = {
      schema: 1,
      vault: {
        credentials: [
          {
            id: 'zq-example',
            domain: 'https://zq.example-pt.test',
            username: 'zq-example-user',
            password: 'zq-example-password',
            autoFillEnabled: true,
          },
        ],
      },
    }

    await expect(getCredentialByHost('zq.example-pt.test')).resolves.toEqual(
      expect.objectContaining({
        domain: 'https://zq.example-pt.test',
        username: 'zq-example-user',
        password: 'zq-example-password',
      }),
    )
  })

  it('每次查询都能读取其他上下文更新后的密码', async () => {
    mocks.privateStore = {
      schema: 1,
      vault: {
        credentials: [
          {
            id: 'zq-example',
            domain: 'zq.example-pt.test',
            username: 'user',
            password: 'old-password',
          },
        ],
      },
    }
    expect((await getCredentialByHost('zq.example-pt.test'))?.password).toBe('old-password')

    const credentials = (mocks.privateStore.vault as { credentials: Array<Record<string, unknown>> })
      .credentials
    credentials[0].password = 'new-password'

    expect((await getCredentialByHost('zq.example-pt.test'))?.password).toBe('new-password')
  })
})
