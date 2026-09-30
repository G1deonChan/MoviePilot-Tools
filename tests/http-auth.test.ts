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

  it('v3 权限不足不续期或清理当前账号', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(403, { success: false, message: 'Forbidden', data: null }))
    const refresh = vi.fn()
    registerTokenRefreshHandler(refresh)
    const result = await request('/api/v1/system/env')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Forbidden')
    expect(refresh).not.toHaveBeenCalled()
    expect(mocks.clearActiveSession).not.toHaveBeenCalled()
  })

  it('普通 JSON 拆包后保持业务对象与数组类型', async () => {
    const sites = [{ id: 1, name: 'PT' }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, { success: true, message: '', data: sites }))
    expect((await request('/api/v1/site/')).data).toEqual(sites)
  })

  it('HTTP 200 的业务失败保留确认信息并返回失败', async () => {
    const body = { success: false, message: '无法识别媒体信息', data: { requires_confirmation: true } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, body))
    const result = await request('/api/v1/download/add', { method: 'POST', body: {} })
    expect(result).toMatchObject({ ok: false, status: 200, error: body.message, data: body })
  })

  it('插件自定义协议保持原样', async () => {
    const body = { success: true, message: '', data: { path: 'admin/backup.json' } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, body))
    expect((await request('/api/v1/plugin/MoviePilotTools/upload')).data).toEqual(body)
  })

  it('空数据操作结果保留 success 且直接响应不变', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const body = { success: true, message: '', data: null }
    fetchMock.mockResolvedValueOnce(response(200, body)).mockResolvedValueOnce(response(200, { name: 'user' }))
    expect((await request('/api/v1/site/', { method: 'PUT', body: {} })).data).toEqual(body)
    expect((await request('/api/v1/user/current')).data).toEqual({ name: 'user' })
  })
})
