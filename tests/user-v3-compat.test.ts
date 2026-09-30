import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.fn()
const apiPut = vi.fn()
const request = vi.fn()

vi.mock('../core/http', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
  request: (...args: unknown[]) => request(...args),
  unwrapApiData: (data: unknown) => {
    if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
      return (data as { data: unknown }).data
    }
    return data
  },
}))

vi.mock('../core/state', () => ({
  appState: {},
}))

vi.mock('../core/storage', () => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  STORAGE_KEYS: {
    SOFTWARE_LATEST_CACHE: 'SOFTWARE_LATEST_CACHE',
    FRONTEND_LATEST_CACHE: 'FRONTEND_LATEST_CACHE',
  },
}))

import { fetchCurrentUser, fetchSystemEnv, updateUserInfo } from '../services/user'

describe('用户服务 v3 兼容', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPut.mockReset()
    request.mockReset()
  })

  it('可读取 v3 标准包装的当前用户', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { success: true, data: { name: 'tester', is_superuser: true } },
    })
    await expect(fetchCurrentUser()).resolves.toEqual({ name: 'tester', is_superuser: true })
  })

  it('可读取 v3 标准包装的系统环境变量', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { success: true, data: { VERSION: '3.0.0' } },
    })
    await expect(fetchSystemEnv()).resolves.toEqual({ VERSION: '3.0.0' })
  })

  it('更新用户资料优先 current，404 时回退旧接口', async () => {
    apiPut
      .mockResolvedValueOnce({ ok: false, status: 404, data: null })
      .mockResolvedValueOnce({ ok: true, status: 200, data: null })
    await expect(updateUserInfo({ name: 'new-name' })).resolves.toBe(true)
    expect(apiPut).toHaveBeenNthCalledWith(1, '/api/v1/user/current', { name: 'new-name' })
    expect(apiPut).toHaveBeenNthCalledWith(2, '/api/v1/user/', { name: 'new-name' })
  })
})
