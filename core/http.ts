// Fetch 薄封装：统一注入 Bearer、401 静默续期重试、统一错误结构
import { clearActiveSession, getActiveBaseUrl, getActiveToken } from './auth-session'

export interface ApiResult<T = unknown> {
  ok: boolean
  status: number
  data: T
  error?: string
}

export function asApiRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

export function unwrapApiData<T = unknown>(data: unknown): T {
  const root = asApiRecord(data)
  if (!root || !('data' in root)) return data as T
  return root.data as T
}

export function readApiMessage(data: unknown): string {
  const root = asApiRecord(data)
  if (!root) return ''
  const message = root.message_i18n ?? root.message ?? root.detail
  return typeof message === 'string' ? message.trim() : ''
}

interface RequestOpts extends Omit<RequestInit, 'body'> {
  baseUrl?: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** 内部：已做过静默刷新重试，防止死循环 */
  __mpRetried?: boolean
}

let tokenRefreshHandler: (() => Promise<string | null>) | null = null

export function registerTokenRefreshHandler(
  handler: (() => Promise<string | null>) | null,
): void {
  tokenRefreshHandler = handler
}

function isTokenLikeUnauthorized(status: number, data: unknown): boolean {
  if (status === 401) return true
  if (status !== 403) return false
  const detail =
    data && typeof data === 'object'
      ? String(
          (data as { detail?: unknown; message?: unknown }).detail ??
            (data as { message?: unknown }).message ??
            '',
        )
      : String(data ?? '')
  return /token|unauth|unauthorized|forbidden|过期|失效|未授权|登录/i.test(detail)
}

export async function request<T = unknown>(
  path: string,
  options: RequestOpts = {},
): Promise<ApiResult<T>> {
  const { baseUrl, query, body, headers, __mpRetried, ...rest } = options
  const base = baseUrl ?? (await getActiveBaseUrl()) ?? ''
  if (!base) return { ok: false, status: 0, data: null as T, error: '未配置服务器地址' }

  let url: URL
  try {
    url = new URL(path, base)
  } catch {
    return { ok: false, status: 0, data: null as T, error: 'URL 无效' }
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }

  const h = new Headers(headers)
  // FormData / 部分请求不要强行 JSON
  if (body !== undefined && !(body instanceof FormData) && !h.has('Content-Type')) {
    h.set('Content-Type', 'application/json')
  }
  const token = await getActiveToken()

  if (token) h.set('Authorization', `Bearer ${token}`)

  try {
    const res = await fetch(url.toString(), {
      ...rest,
      headers: h,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData || typeof body === 'string'
            ? body
            : JSON.stringify(body),
    })

    let data: unknown = null
    const text = await res.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    // Token 失效时静默刷新，并且只重试一次以防止请求循环。
    if (isTokenLikeUnauthorized(res.status, data) && !__mpRetried) {
      try {
        const newToken = await tokenRefreshHandler?.()
        if (newToken) {
          return request<T>(path, { ...options, __mpRetried: true })
        }
      } catch {
        /* Token 刷新失败后继续清理当前会话并通知 UI。 */
      }
      // 刷新失败：清当前会话 Token（账号库密码保留）并通知 UI
      try {
        await clearActiveSession()
      } catch {
        // 会话清理失败时仍通知 UI，由用户重新登录
      }
      void sendUnauthorized()
    } else if (res.status === 401 && __mpRetried) {
      void sendUnauthorized()
    }

    return { ok: res.ok, status: res.status, data: data as T }
  } catch (e) {
    return { ok: false, status: 0, data: null as T, error: String(e) }
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOpts['query']) =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown, query?: RequestOpts['query']) =>
    request<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

let unauthorizedHandler: (() => void) | null = null
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}
function sendUnauthorized(): void {
  try {
    unauthorizedHandler?.()
  } catch {
    /* UI 未授权处理器失败不改变原请求结果。 */
  }
}
