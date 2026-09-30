// 下载管理服务：任务列表、启停删除、添加下载、目录
import { api } from '../core/http'
import { findTorrentForPage, normalizeTorrentPageTitle } from './site-torrent'
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
export async function addDownload(payload: AddDownloadRequest): Promise<{ ok: boolean; message?: string; requiresConfirmation?: boolean }> {
  // v3 媒体身份成对提交；旧调用方的来源字段在边界转换。
  const { tmdbid, doubanid, ...body } = payload
  if (!body.media_source && !body.media_id) {
    if (tmdbid) {
      body.media_source = 'themoviedb'
      body.media_id = String(tmdbid)
    } else if (doubanid) {
      body.media_source = 'douban'
      body.media_id = doubanid
    }
  }
  if (!!body.media_source !== !!body.media_id) return { ok: false, message: '媒体来源和媒体 ID 必须同时提供' }
  const res = await api.post<{ success?: boolean; message?: string; data?: { requires_confirmation?: boolean } }>('/api/v1/download/add', body)
  if (!res.ok) return {
    ok: false,
    message: res.error || res.data?.message || '请求失败',
    requiresConfirmation: res.data?.data?.requires_confirmation === true,
  }
  if (res.data && typeof res.data === 'object' && 'success' in res.data && res.data.success === false) {
    return { ok: false, message: res.data.message || '添加失败', requiresConfirmation: res.data.data?.requires_confirmation === true }
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
  keyword?: string,
): Promise<{ ok: boolean; data: AddTorrentIn[]; message?: string }> {
  const res = await api.get<unknown>(`/api/v1/site/resource/${siteId}`, { page, ...(keyword ? { keyword } : {}) })
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

/** 按详情地址精确匹配；首页未命中时搜索标题并有限翻页，防止遍历整个站点。 */
export async function resolveSiteTorrent(
  siteId: number,
  pageUrl: string,
  title = '',
): Promise<{ ok: boolean; torrent?: AddTorrentIn; message?: string }> {
  const keyword = normalizeTorrentPageTitle(title).slice(0, 200)
  const queries: Array<{ page: number; keyword?: string }> = [{ page: 0 }]
  if (keyword && keyword !== '未知种子') {
    for (let page = 0; page < 3; page++) queries.push({ page, keyword })
  }
  queries.push({ page: 1 }, { page: 2 })
  const exhausted = new Set<string>()
  let sawResources = false
  for (const query of queries) {
    const key = query.keyword || ''
    if (exhausted.has(key)) continue
    const result = await fetchSiteResources(siteId, query.page, query.keyword)
    if (!result.ok) return { ok: false, message: result.message }
    if (!result.data.length) {
      exhausted.add(key)
      continue
    }
    sawResources = true
    const torrent = findTorrentForPage(pageUrl, result.data)
    if (torrent?.enclosure) return { ok: true, torrent }
  }
  return {
    ok: false,
    message: sawResources
      ? '已查询站点资源及标题搜索的前 3 页，仍未找到与当前详情页编号匹配的种子。请核对详情页链接，或使用种子下载链接推送。'
      : 'MoviePilot 未返回站点资源。请检查该站点的连接测试、Cookie 和资源浏览支持。',
  }
}
