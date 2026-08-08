import { bufToB64 } from '../core/crypto'
import { directDownloadToMp, healthMp, type MpDirectDownloadResult } from '../core/mp-backend'

export interface DirectDownloadOptions {
  downloader: string
  savePath: string
  labels?: string
}

export function isMediaRecognitionFailure(message?: string): boolean {
  return /无法识别媒体信息|未识别到媒体信息|媒体识别失败|识别媒体.*失败/i.test(message || '')
}

function directPayloadOptions(options: DirectDownloadOptions) {
  return {
    downloader: options.downloader,
    save_path: options.savePath,
    labels: options.labels || undefined,
  }
}

export function unwrapTorrentUrl(value: string): string {
  const input = value.trim()
  if (!input.startsWith('[')) return input
  const end = input.indexOf(']')
  if (end < 0) return input
  const url = input.slice(end + 1).trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('该站点种子链接需要 MoviePilot 动态解析，暂不支持直连降级')
  return url
}

export async function directDownloadMagnet(
  magnet: string,
  options: DirectDownloadOptions,
): Promise<MpDirectDownloadResult> {
  return directDownloadToMp({
    type: 'magnet',
    content: magnet.trim(),
    ...directPayloadOptions(options),
  })
}

export async function fetchTorrentBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const target = unwrapTorrentUrl(url)
  if (!/^https?:\/\//i.test(target)) throw new Error('种子链接仅支持 http/https')

  const response = await fetch(target, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow',
    headers: { Accept: 'application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.8' },
  })
  if (!response.ok) throw new Error(`种子文件获取失败 HTTP ${response.status}`)

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > maxBytes) throw new Error(`种子文件超过插件限制 ${(maxBytes / 1024 / 1024).toFixed(1)}MB`)

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength) throw new Error('种子文件内容为空')
  if (bytes.byteLength > maxBytes) {
    throw new Error(`种子文件超过插件限制 ${(maxBytes / 1024 / 1024).toFixed(1)}MB`)
  }
  if (bytes[0] !== 0x64) throw new Error('下载内容不是有效的 torrent 文件')
  return bytes
}

export async function directDownloadTorrentUrl(
  url: string,
  options: DirectDownloadOptions,
): Promise<MpDirectDownloadResult> {
  const health = await healthMp()
  if (!health.ok) return { ok: false, error: health.error || '无法连接 MoviePilotTools 插件' }
  if (!health.data?.capabilities?.direct_download) {
    return { ok: false, error: 'MoviePilotTools 插件未启用直接下载，请升级并检查插件设置' }
  }
  const maxBytes = health.data.capabilities.max_torrent_size || 10 * 1024 * 1024
  const bytes = await fetchTorrentBytes(url, maxBytes)
  return directDownloadToMp({
    type: 'torrent',
    content: bufToB64(bytes),
    ...directPayloadOptions(options),
  })
}
