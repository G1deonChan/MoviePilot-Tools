// 下载管理服务：任务列表、启停删除、添加下载、目录
import { api } from '../core/http'
import type {
  DownloadTask,
  DownloadClient,
  DownloadDirectory,
  AddDownloadRequest,
  AddTorrentIn,
} from '../core/types'

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data as T[]
    if (Array.isArray(obj.items)) return obj.items as T[]
  }
  return []
}

export async function fetchClients(): Promise<DownloadClient[]> {
  const res = await api.get<unknown>('/api/v1/download/clients')
  if (!res.ok) return []
  return asArray<DownloadClient>(res.data)
}

/** 获取正在下载任务；name 为下载器名称 */
export async function fetchTasks(name?: string): Promise<DownloadTask[]> {
  const res = await api.get<unknown>('/api/v1/download/', name ? { name } : undefined)
  if (!res.ok) return []
  return asArray<DownloadTask>(res.data)
}

export async function startDownload(hash: string, name?: string): Promise<boolean> {
  const res = await api.get<{ success?: boolean }>(`/api/v1/download/start/${hash}`, name ? { name } : undefined)
  return res.ok && (res.data?.success !== false)
}

export async function stopDownload(hash: string, name?: string): Promise<boolean> {
  const res = await api.get<{ success?: boolean }>(`/api/v1/download/stop/${hash}`, name ? { name } : undefined)
  return res.ok && (res.data?.success !== false)
}

export async function deleteTask(hash: string, name?: string): Promise<boolean> {
  // DELETE 带 query：走 request 的 query 参数
  const res = await api.del<{ success?: boolean }>(
    name
      ? `/api/v1/download/${hash}?name=${encodeURIComponent(name)}`
      : `/api/v1/download/${hash}`,
  )
  return res.ok && (res.data?.success !== false)
}

/** 添加下载（不含媒体信息） */
export async function addDownload(payload: AddDownloadRequest): Promise<{ ok: boolean; message?: string }> {
  const res = await api.post<{ success?: boolean; message?: string }>('/api/v1/download/add', payload)
  if (!res.ok) return { ok: false, message: res.error || '请求失败' }
  if (res.data && typeof res.data === 'object' && 'success' in res.data && res.data.success === false) {
    return { ok: false, message: res.data.message || '添加失败' }
  }
  return { ok: true }
}

/** 添加下载（含媒体信息） */
export async function addDownloadWithMedia(
  payload: AddDownloadRequest,
): Promise<{ ok: boolean; message?: string }> {
  const res = await api.post<{ success?: boolean; message?: string }>('/api/v1/download/', payload)
  if (!res.ok) return { ok: false, message: res.error || '请求失败' }
  if (res.data && typeof res.data === 'object' && 'success' in res.data && res.data.success === false) {
    return { ok: false, message: res.data.message || '添加失败' }
  }
  return { ok: true }
}

export async function fetchDirectories(): Promise<DownloadDirectory[]> {
  const res = await api.get<unknown>('/api/v1/download/paths')
  if (!res.ok) return []
  return asArray<DownloadDirectory>(res.data)
}

export async function recognizeMedia(
  title: string,
  subtitle?: string,
): Promise<{ media_info?: Record<string, unknown> }> {
  const res = await api.get<{ media_info?: Record<string, unknown> }>('/api/v1/media/recognize', {
    title,
    ...(subtitle ? { subtitle } : {}),
  })
  return res.ok && res.data ? res.data : {}
}

export async function fetchSiteResources(
  siteId: number,
  page = 0,
): Promise<{ ok: boolean; data: AddTorrentIn[]; message?: string }> {
  const res = await api.get<unknown>(`/api/v1/site/resource/${siteId}`, { page })
  if (!res.ok) return { ok: false, data: [], message: res.error || '站点资源请求失败' }
  if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    const body = res.data as { success?: unknown; message?: unknown }
    if (body.success === false) {
      return {
        ok: false,
        data: [],
        message: typeof body.message === 'string' ? body.message : '站点资源加载失败',
      }
    }
  }
  return { ok: true, data: asArray<AddTorrentIn>(res.data) }
}
