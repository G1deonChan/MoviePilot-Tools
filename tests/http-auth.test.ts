import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveBaseUrl: vi.fn(async () => 'https://server.test'),
  getActiveToken: vi.fn(async () => 'old-token'),
  clearActiveSession: vi.fn(async () => undefined),
}))

vi.mock('../core/auth-session', () => ({
  getActiveBaseUrl: mocks.getActiveBaseUrl,
  getActiveToken: mocks.getActiveToken,
  clearActiveSession: mocks.clearActiveSession,
}))

import { onUnauthorized, registerTokenRefreshHandler, request } from '../core/http'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('HTTP 认证刷新', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.getActiveBaseUrl.mockResolvedValue('https://server.test')
    mocks.getActiveToken.mockResolvedValue('old-token')
    mocks.clearActiveSession.mockClear()
    registerTokenRefreshHandler(null)
    onUnauthorized(null)
  })

  it('401 时刷新 Token 并只重试一次', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(401, { detail: 'token expired' }))
      .mockResolvedValueOnce(response(200, { ok: true }))
    const refresh = vi.fn(async () => 'new-token')
    registerTokenRefreshHandler(refresh)

    const result = await request<{ ok: boolean }>('/api/v1/system/env')

    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.clearActiveSession).not.toHaveBeenCalled()
  })

  it('刷新失败时清理会话并通知 UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(401, { detail: 'unauthorized' }))
    registerTokenRefreshHandler(vi.fn(async () => null))
    const unauthorized = vi.fn()
    onUnauthorized(unauthorized)

    const result = await request('/api/v1/system/env')

    expect(result.status).toBe(401)
    expect(mocks.clearActiveSession).toHaveBeenCalledTimes(1)
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('没有刷新处理器时仍清理会话', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(401, { detail: 'unauthorized' }))

    await request('/api/v1/system/env')

    expect(mocks.clearActiveSession).toHaveBeenCalledTimes(1)
  })
})
