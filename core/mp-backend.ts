// MP 插件数据目录同步后端（架构 §十一，可选）
// 经 MP 插件 MoviePilotTools 暴露的文件端点，将扩展数据以「文件」形式落插件数据目录
// 最终 URL：/api/v1/plugin/MoviePilotTools/{upload|download|list|delete|health}
// 敏感项（Token/PIN/密钥）永不调用此后端
import { api } from './http'
import { b64ToBuf, bufToB64 } from './crypto'
import { getActiveLoginUsername, getActiveUserInfo } from './auth-session'

/** MoviePilotTools 插件 API 的固定路由前缀。 */
export const MP_PLUGIN_ID = 'MoviePilotTools'
const PLUGIN_BASE = `/api/v1/plugin/${MP_PLUGIN_ID}`

export interface MpFileMeta {
  path: string
  size?: number
  updatedAt?: number
  is_dir?: boolean
}

export interface MpHealth {
  enabled: boolean
  data_path?: string
  max_file_size?: number
  allowed_suffixes?: string[]
  plugin_version?: string
  capabilities?: {
    direct_download?: boolean
    direct_download_types?: Array<'magnet' | 'torrent'>
    max_torrent_size?: number
  }
}

export interface MpDirectDownloadRequest {
  type: 'magnet' | 'torrent'
  content: string
  downloader: string
  save_path: string
  labels?: string
}

export interface MpDirectDownloadResult {
  ok: boolean
  downloadId?: string
  downloader?: string
  layout?: string
  savePath?: string
  error?: string
  status?: number
}

export interface MpUploadProgress {
  transferredBytes: number
  totalBytes: number
  chunkIndex: number
  chunkCount: number
}

export interface MpDownloadProgress {
  transferredBytes: number
  totalBytes: number
  chunkIndex: number
  chunkCount: number
}

export interface MpUploadResult {
  ok: boolean
  path?: string
  size?: number
  updatedAt?: number
  error?: string
  status?: number
}

export const MP_CHUNK_BYTES = 256 * 1024

export function splitMpUploadBytes(content: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(content)
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += MP_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + MP_CHUNK_BYTES))
  }
  return chunks.length ? chunks : [new Uint8Array()]
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** 用户命名空间：优先 MP 用户名，回退登录名；去掉路径非法字符，保留 Unicode 字母 */
export async function resolveMpUserNamespace(): Promise<string> {
  const info = await getActiveUserInfo()
  const login = await getActiveLoginUsername()
  const raw = (info?.userName || login || 'default').trim() || 'default'
  const safe = raw
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/\.\./g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (safe || 'default').slice(0, 64)
}

/** 拼用户隔离相对路径，如 admin/backups/xxx.json */
export async function mpUserPath(...parts: string[]): Promise<string> {
  const user = await resolveMpUserNamespace()
  const segs = parts
    .map((p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
  return [user, ...segs].join('/')
}

export async function healthMp(): Promise<{ ok: boolean; data: MpHealth | null; error?: string }> {
  const res = await api.get<{ code?: number; data?: MpHealth; message?: string }>(
    `${PLUGIN_BASE}/health`,
  )
  if (!res.ok) {
    return {
      ok: false,
      data: null,
      error: res.status === 404
        ? '未找到 MoviePilotTools 插件，请安装支持 v3 的配套插件后使用插件备份或直接下载。'
        : res.error || `健康检查失败（HTTP ${res.status}）`,
    }
  }
  const root = asRecord(res.data)
  const data = (root?.data as MpHealth | undefined) ?? (res.data as MpHealth | null)
  return { ok: true, data: data ?? null }
}

export async function directDownloadToMp(
  payload: MpDirectDownloadRequest,
): Promise<MpDirectDownloadResult> {
  const health = await healthMp()
  if (!health.ok) return { ok: false, error: health.error || '无法连接 MoviePilotTools 插件' }
  if (!health.data?.enabled) return { ok: false, error: 'MoviePilotTools 插件未启用' }
  if (!health.data.capabilities?.direct_download) {
    return { ok: false, error: 'MoviePilotTools 插件未启用直接下载，请升级并检查插件设置' }
  }
  if (!health.data.capabilities.direct_download_types?.includes(payload.type)) {
    return { ok: false, error: `MoviePilotTools 插件不支持 ${payload.type} 直接下载` }
  }

  const res = await api.post<{
    code?: number
    message?: string
    data?: {
      success?: boolean
      download_id?: string
      downloader?: string
      layout?: string
      save_path?: string
    }
  }>(`${PLUGIN_BASE}/download/direct`, payload)
  const root = asRecord(res.data)
  const data = asRecord(root?.data)
  if (!res.ok || data?.success === false) {
    return {
      ok: false,
      status: res.status,
      error: res.error || String(root?.message || `直接下载失败 HTTP ${res.status}`),
    }
  }
  return {
    ok: true,
    status: res.status,
    downloadId: typeof data?.download_id === 'string' ? data.download_id : undefined,
    downloader: typeof data?.downloader === 'string' ? data.downloader : undefined,
    layout: typeof data?.layout === 'string' ? data.layout : undefined,
    savePath: typeof data?.save_path === 'string' ? data.save_path : undefined,
  }
}

export async function uploadToMp(
  path: string,
  content: string,
  opts?: { encoding?: 'utf-8' | 'base64'; updatedAt?: number },
): Promise<MpUploadResult> {
  const res = await api.post<{
    code?: number
    message?: string
    data?: { path?: string; size?: number; updatedAt?: number }
  }>(`${PLUGIN_BASE}/upload`, {
    path,
    content,
    encoding: opts?.encoding ?? 'utf-8',
    updatedAt: opts?.updatedAt,
  })
  if (!res.ok) {
    const root = asRecord(res.data)
    return {
      ok: false,
      status: res.status,
      error: res.error || String(root?.message || `上传失败 HTTP ${res.status}`),
    }
  }
  const root = asRecord(res.data)
  const data = asRecord(root?.data) ?? {}
  return {
    ok: true,
    status: res.status,
    path: String(data.path || path),
    size: typeof data.size === 'number' ? data.size : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
  }
}

export async function uploadLargeBytesToMp(
  path: string,
  bytes: Uint8Array,
  updatedAt = Date.now(),
  onProgress?: (progress: MpUploadProgress) => void,
): Promise<MpUploadResult> {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += MP_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + MP_CHUNK_BYTES))
  }
  if (!chunks.length) chunks.push(new Uint8Array())
  const total = chunks.length
  const uploadId = crypto.randomUUID().replace(/-/g, '')
  let last: MpUploadResult = { ok: false }

  for (let index = 0; index < total; index += 1) {
    const chunk = chunks[index]
    const res = await api.post<{
      code?: number
      message?: string
      data?: { path?: string; size?: number; updatedAt?: number; completed?: boolean }
    }>(`${PLUGIN_BASE}/upload_chunk`, {
      path,
      upload_id: uploadId,
      index,
      total,
      content: bufToB64(chunk),
      updatedAt,
    })
    if (!res.ok) {
      const root = asRecord(res.data)
      return {
        ok: false,
        status: res.status,
        error: res.error || String(root?.message || `分块上传失败 HTTP ${res.status}`),
      }
    }
    const root = asRecord(res.data)
    const data = asRecord(root?.data) ?? {}
    last = {
      ok: true,
      status: res.status,
      path: String(data.path || path),
      size: typeof data.size === 'number' ? data.size : undefined,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
    }
    onProgress?.({
      transferredBytes: Math.min(bytes.byteLength, (index + 1) * MP_CHUNK_BYTES),
      totalBytes: bytes.byteLength,
      chunkIndex: index + 1,
      chunkCount: total,
    })
  }
  return last
}

export async function uploadLargeToMp(
  path: string,
  content: string,
  updatedAt = Date.now(),
): Promise<MpUploadResult> {
  return uploadLargeBytesToMp(path, new TextEncoder().encode(content), updatedAt)
}

export async function downloadFromMp(path: string): Promise<string | null> {
  const res = await api.get<{
    content?: string
    data?: { content?: string }
    message?: string
  }>(`${PLUGIN_BASE}/download`, { path })
  if (!res.ok) return null
  const data = res.data
  if (!data) return null
  if (typeof data.content === 'string') return data.content
  if (typeof data.data?.content === 'string') return data.data.content
  return null
}

export async function downloadLargeBytesFromMp(
  path: string,
  onProgress?: (progress: MpDownloadProgress) => void,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total) {
    const res = await api.get<{
      code?: number
      message?: string
      data?: {
        content?: string
        next_offset?: number
        total?: number
        done?: boolean
      }
    }>(`${PLUGIN_BASE}/download_chunk`, { path, offset, size: MP_CHUNK_BYTES })
    if (!res.ok) return null
    const root = asRecord(res.data)
    const data = asRecord(root?.data)
    if (!data || typeof data.content !== 'string') return null
    const chunk = b64ToBuf(data.content)
    chunks.push(chunk)
    const next = typeof data.next_offset === 'number' ? data.next_offset : offset + chunk.byteLength
    total = typeof data.total === 'number' ? data.total : total
    const transferredBytes = Math.min(total, next)
    const chunkCount = Number.isFinite(total) ? Math.max(1, Math.ceil(total / MP_CHUNK_BYTES)) : chunks.length
    onProgress?.({
      transferredBytes,
      totalBytes: Number.isFinite(total) ? total : transferredBytes,
      chunkIndex: chunks.length,
      chunkCount,
    })
    if (data.done === true) break
    if (next <= offset) return null
    offset = next
  }

  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(length)
  let cursor = 0
  for (const chunk of chunks) {
    bytes.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  return bytes
}

export async function downloadLargeFromMp(path: string): Promise<string | null> {
  const bytes = await downloadLargeBytesFromMp(path)
  return bytes ? new TextDecoder().decode(bytes) : null
}

export async function listFromMp(prefix = ''): Promise<MpFileMeta[]> {
  const res = await api.get<{
    data?: { files?: MpFileMeta[] }
    files?: MpFileMeta[]
  }>(`${PLUGIN_BASE}/list`, prefix ? { prefix } : undefined)
  if (!res.ok) {
    const root = asRecord(res.data)
    throw new Error(String(root?.message || res.error || `列取失败 HTTP ${res.status}`))
  }
  const root = asRecord(res.data)
  const data = asRecord(root?.data)
  const files = (data?.files as MpFileMeta[] | undefined)
    ?? (root?.files as MpFileMeta[] | undefined)
    ?? []
  return Array.isArray(files) ? files : []
}

export async function deleteFromMp(path: string): Promise<boolean> {
  const res = await api.post(`${PLUGIN_BASE}/delete`, { path })
  return res.ok
}
