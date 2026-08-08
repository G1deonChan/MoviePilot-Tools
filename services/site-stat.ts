// 站点数据服务：连接统计、用户数据、映射、图标
import { api } from '../core/http'
import type { SiteConnectionStat, SiteUserData } from '../core/types'

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data as T[]
    if (Array.isArray(obj.items)) return obj.items as T[]
  }
  return []
}





/** 各站点连接统计列表 */
export async function fetchConnectionStats(): Promise<SiteConnectionStat[]> {
  const res = await api.get<unknown>('/api/v1/site/statistic')
  if (!res.ok) return []
  return asArray<SiteConnectionStat>(res.data).filter((x) => !!x?.domain)
}

/** 最新站点用户数据 */
export async function fetchUserDataLatest(): Promise<SiteUserData[]> {
  const res = await api.get<unknown>('/api/v1/site/userdata/latest')
  if (!res.ok) return []
  return asArray<SiteUserData>(res.data)
}

type RefreshUserDataResponse = {
  success?: boolean
  message?: string
  message_i18n?: string
  detail?: string
}

/** 刷新单个站点用户数据（MP 后端仅提供逐站刷新接口） */
export async function refreshSiteUserData(
  siteId: number,
): Promise<{ success: boolean; message: string }> {
  const res = await api.post<RefreshUserDataResponse>(`/api/v1/site/userdata/${siteId}`)
  const data = res.data
  const message = data?.message_i18n || data?.message || data?.detail || res.error || ''
  if (!res.ok) return { success: false, message: message || `请求失败（${res.status || '网络错误'}）` }
  return {
    success: data?.success === true,
    message: data?.success === true ? message : message || '站点数据刷新失败',
  }
}

/** 通过站点 ID 拉取图标（data URL 或 http） */
export async function fetchSiteIconById(siteId: number): Promise<string | null> {
  if (!siteId) return null
  const res = await api.get<unknown>(`/api/v1/site/icon/${siteId}`)
  if (!res.ok || res.data == null) return null
  const data = res.data as Record<string, unknown> | string
  if (typeof data === 'string' && (data.startsWith('data:') || data.startsWith('http'))) {
    return data
  }
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>).data as
      | Record<string, unknown>
      | string
      | undefined
    if (typeof nested === 'string' && nested) return nested
    if (nested && typeof nested === 'object' && typeof nested.icon === 'string') {
      return nested.icon as string
    }
    if (typeof (data as Record<string, unknown>).icon === 'string') {
      return (data as Record<string, unknown>).icon as string
    }
  }
  return null
}
