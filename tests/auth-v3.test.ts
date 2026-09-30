import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'

let store: PrivateStoreV1 = { schema: 1 }
vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(store)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    mutator(store)
    return structuredClone(store)
  }),
}))
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../core/http', () => ({ api: { get }, registerTokenRefreshHandler: vi.fn() }))
import { login, ping } from '../services/auth'

function json(body: unknown, status = 200, headers = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('v3 登录合同', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    store = { schema: 1 }
    get.mockReset()
  })

  it('未初始化时提示网页创建管理员，不尝试登录或保存账号', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ success: true, message: '', data: { initialized: false } }))
    expect((await login('https://mp.test', 'admin', 'password')).message).toContain('尚未初始化')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.auth).toBeUndefined()
  })

  it('识别统一 MFA challenge，不保存失败账号', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ success: true, message: '', data: { initialized: true } }))
      .mockResolvedValueOnce(json({ success: false, message: '需要二次验证', data: { mfa_methods: ['otp'] } }, 401, { 'X-MFA-Required': 'true' }))
    expect(await login('https://mp.test', 'admin', 'password')).toMatchObject({ success: false, mfaRequired: true, mfaMethods: ['otp'] })
    expect(store.auth).toBeUndefined()
  })

  it('登录 Token 保持原始 OAuth 格式并携带表单验证码', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ access_token: 'test-token', user_id: 1, user_name: 'admin', super_user: true }))
    expect((await login('https://mp.test', 'admin', 'password', '123456')).success).toBe(true)
    expect(new URLSearchParams(String(fetch.mock.calls[1][1]?.body)).get('otp_password')).toBe('123456')
    expect(store.auth?.session?.token).toBe('test-token')
  })

  it('普通用户会话检查使用当前用户接口', async () => {
    get.mockResolvedValue({ ok: true })
    expect(await ping()).toBe(true)
    expect(get).toHaveBeenCalledWith('/api/v1/user/current')
  })
})
