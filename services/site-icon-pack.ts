// 外置高清站点图标包：ZIP 导入 → IndexedDB，不打进扩展包
// 包结构：manifest.json + icons/<prefix>.png（或根目录 <prefix>.png）

const DB_NAME = 'mpt2-site-icons-v1'

const DB_VERSION = 1
const STORE_ICONS = 'icons'
const STORE_META = 'meta'
const META_KEY = 'pack'

export interface SiteIconPackMeta {
  id: typeof META_KEY
  name: string
  version: number | string
  count: number
  importedAt: number
  /** 约略字节数（dataURL 原文长度） */
  bytes: number
  format: 'mp-site-icons'
}

interface IconRecord {
  prefix: string
  dataUrl: string
}

/** 内存缓存：prefix → dataURL */
const memoryCache = new Map<string, string>()
let metaCache: SiteIconPackMeta | null | undefined
let readyPromise: Promise<void> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('打开图标库失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ICONS)) {
        db.createObjectStore(STORE_ICONS, { keyPath: 'prefix' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' })
      }
    }
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
  })
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'))
  })
}

/** 规范化主机名：去协议/路径/端口/www */
export function normalizeHost(input: string): string {
  let s = (input || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\//i, '').replace(/^\/+/, '')
  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0]
  s = s.replace(/^www\./, '')
  return s
}

/** 仅保留字母数字，用于匹配 `hd_home`、`hd-home` 和 `hdhome` 等命名变体。 */
export function alnumKey(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 对一段文本生成可能的文件名键 */
function pushSlugVariants(out: string[], raw: string): void {
  const s = (raw || '').trim().toLowerCase()
  if (!s) return
  const add = (v: string) => {
    const t = v.trim().toLowerCase()
    if (!t || out.includes(t)) return
    // 过短易误匹配
    if (t.length < 2 && !/^\d+$/.test(t)) return
    out.push(t)
  }
  add(s)
  add(s.replace(/\./g, '_'))
  add(s.replace(/\./g, '-'))
  add(s.replace(/[._]+/g, '-'))
  add(s.replace(/[._-]+/g, '_'))
  add(alnumKey(s))
}

/**
 * 从域名提取「注册域」简化版（默认取末两段：0ff.cc）。
 * 多级后缀（co.uk 等）仍可能不准，优先靠 supporting 域名键修正。
 */
export function extractRegistrableDomain(domain: string): string {
  const host = normalizeHost(domain)
  if (!host) return ''
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  return parts.slice(-2).join('.')
}

/** @deprecated 仅为仍调用首段域名提取 API 的调用方保留；子域可能误匹配，优先使用 `iconPrefixCandidates`，在该 API 仍对外暴露期间保留。 */
export function extractDomainPrefix(domain: string): string {
  const host = normalizeHost(domain)
  if (!host) return ''
  const parts = host.split('.').filter(Boolean)
  // 优先注册域第一段（0ff.cc → 0ff），而不是子域第一段（pt.0ff.cc → 不再返回 pt）
  if (parts.length >= 2) return parts[parts.length - 2]
  return parts[0] || host
}

export interface IconMatchHints {
  /** supporting 映射中的域名键，如 0ff.cc */
  supportingDomain?: string
  /** 站点显示名，如 自由农场 / HDHome */
  name?: string
  /** 完整 URL，用于补主机 */
  url?: string
}

/**
 * 候选图标文件名键（按特异性从高到低）。
 * 例：pt.0ff.cc + supporting 0ff.cc → 0ff.cc / 0ff_cc / 0ff / …
 */
export function iconPrefixCandidates(domain: string, hints: IconMatchHints = {}): string[] {
  const out: string[] = []
  const host = normalizeHost(domain || hints.url || '')
  const support = normalizeHost(hints.supportingDomain || '')
  const reg = host ? extractRegistrableDomain(host) : ''

  // 1. 完整 host / supporting 键 / 注册域（最具体）
  if (host) pushSlugVariants(out, host)
  if (support) pushSlugVariants(out, support)
  if (reg && reg !== host) pushSlugVariants(out, reg)

  // 2. 注册域 / supporting 的 SLD（0ff.cc → 0ff）——核心命中
  const sldFrom = (h: string) => {
    const p = h.split('.').filter(Boolean)
    return p.length >= 2 ? p[p.length - 2] : p[0] || ''
  }
  if (support) pushSlugVariants(out, sldFrom(support))
  if (reg) pushSlugVariants(out, sldFrom(reg))
  if (host && host !== reg) pushSlugVariants(out, sldFrom(host))

  // 3. 英文站点名（仅 ASCII 有意义时）
  const name = (hints.name || '').trim()
  if (name && /[a-zA-Z0-9]/.test(name)) {
    pushSlugVariants(out, name)
    pushSlugVariants(out, name.replace(/\s+/g, ''))
    pushSlugVariants(out, name.replace(/\s+/g, '_'))
    pushSlugVariants(out, name.replace(/\s+/g, '-'))
  }

  // 4. 主机各 label（把子域 label 放最后，降低 pt/www 误匹配）
  if (host) {
    const labels = host.split('.').filter(Boolean)
    for (let i = labels.length - 2; i >= 0; i--) {
      // 跳过过泛的 label
      const lab = labels[i]
      if (['www', 'pt', 'www2', 'bbs', 'forum', 'tracker'].includes(lab)) continue
      pushSlugVariants(out, lab)
    }
  }

  return out
}

/** alnum → 包内原始 key 列表（导入后构建） */
const alnumIndex = new Map<string, string[]>()

function rebuildAlnumIndex(): void {
  alnumIndex.clear()
  for (const key of memoryCache.keys()) {
    const a = alnumKey(key)
    if (!a) continue
    const list = alnumIndex.get(a) || []
    if (!list.includes(key)) list.push(key)
    alnumIndex.set(a, list)
  }
}

/**
 * 在候选键中查找图标：
 * 1) 精确 key
 * 2) alnum 等价（hd_home ↔ hdhome）
 * 3) 同 alnum 多结果时优先无 -new/-old 后缀、更短文件名
 */
function pickBestKey(keys: string[]): string | null {
  if (!keys.length) return null
  if (keys.length === 1) return keys[0]
  const score = (k: string) => {
    let s = 0
    if (/-new$/i.test(k) || /_new$/i.test(k)) s -= 5
    if (/-old$/i.test(k) || /_old$/i.test(k)) s -= 4
    if (/-bak$/i.test(k)) s -= 3
    // 更短更干净优先
    s -= k.length * 0.01
    return s
  }
  return [...keys].sort((a, b) => score(b) - score(a))[0]
}

function lookupIconByCandidates(candidates: string[]): string | null {
  // 精确
  for (const c of candidates) {
    const hit = memoryCache.get(c)
    if (hit) return hit
  }
  // alnum 等价
  for (const c of candidates) {
    const a = alnumKey(c)
    if (!a || a.length < 2) continue
    const keys = alnumIndex.get(a)
    if (!keys?.length) continue
    const best = pickBestKey(keys)
    if (best) {
      const hit = memoryCache.get(best)
      if (hit) return hit
    }
  }
  return null
}

async function loadAllIntoMemory(): Promise<void> {
  memoryCache.clear()
  metaCache = null
  try {
    const db = await openDb()
    try {
      const tx = db.transaction([STORE_ICONS, STORE_META], 'readonly')
      const icons = await idbReq<IconRecord[]>(tx.objectStore(STORE_ICONS).getAll())
      const meta = await idbReq<SiteIconPackMeta | undefined>(
        tx.objectStore(STORE_META).get(META_KEY),
      )
      await idbTxDone(tx)
      for (const row of icons || []) {
        if (row?.prefix && row?.dataUrl) memoryCache.set(row.prefix, row.dataUrl)
      }
      rebuildAlnumIndex()
      metaCache = meta ?? null
    } finally {
      db.close()
    }
  } catch {
    metaCache = null
    alnumIndex.clear()
  }
}

/** 确保内存缓存就绪 */
export function ensureIconPackReady(): Promise<void> {
  if (!readyPromise) readyPromise = loadAllIntoMemory()
  return readyPromise
}

export async function getIconPackMeta(): Promise<SiteIconPackMeta | null> {
  await ensureIconPackReady()
  return metaCache ?? null
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; extension: string } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) throw new Error('图标数据格式无效')
  const mime = match[1].toLowerCase()
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const extension =
    mime === 'image/jpeg'
      ? 'jpg'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/gif'
          ? 'gif'
          : mime === 'image/svg+xml'
            ? 'svg'
            : 'png'
  return { bytes, extension }
}

/** 按现有导入结构导出：manifest.json + icons/<prefix>.<ext>。 */
export async function exportIconPackZip(): Promise<ArrayBuffer | null> {
  await ensureIconPackReady()
  const meta = metaCache ?? null
  if (!meta || memoryCache.size === 0) return null

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: 'mp-site-icons',
        name: meta.name,
        version: meta.version,
        count: memoryCache.size,
      },
      null,
      2,
    ),
  )
  for (const [prefix, dataUrl] of memoryCache) {
    const { bytes, extension } = dataUrlToBytes(dataUrl)
    zip.file(`icons/${prefix}.${extension}`, bytes)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** 同步查内存（需先 ensureIconPackReady） */
export function getLocalIconFromPackSync(
  domain: string,
  hints: IconMatchHints = {},
): string | null {
  if (memoryCache.size === 0) return null
  const host = normalizeHost(domain || hints.url || '')
  if (!host && !hints.supportingDomain && !hints.name) return null
  const candidates = iconPrefixCandidates(host || domain, hints)
  return lookupIconByCandidates(candidates)
}

export async function getLocalIconFromPack(
  domain: string,
  hints: IconMatchHints = {},
): Promise<string | null> {
  await ensureIconPackReady()
  return getLocalIconFromPackSync(domain, hints)
}

export async function clearIconPack(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_ICONS, STORE_META], 'readwrite')
    tx.objectStore(STORE_ICONS).clear()
    tx.objectStore(STORE_META).clear()
    await idbTxDone(tx)
  } finally {
    db.close()
  }
  memoryCache.clear()
  alnumIndex.clear()
  metaCache = null
  readyPromise = Promise.resolve()
}

// ZIP 读取，仅支持 store 与 deflate

function u16(view: DataView, off: number): number {
  return view.getUint16(off, true)
}
function u32(view: DataView, off: number): number {
  return view.getUint32(off, true)
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // 浏览器原生：raw deflate（ZIP method 8 无 zlib 头）
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'image/png'
}

function normalizeIconPath(path: string): string | null {
  const n = path.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!n || n.endsWith('/')) return null
  if (n.toLowerCase() === 'manifest.json') return null
  // icons/m-team.png 或 m-team.png
  const base = n.includes('/') ? n.split('/').pop()! : n
  if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(base)) return null
  return base.replace(/\.[^.]+$/, '').toLowerCase()
}

interface ZipEntry {
  name: string
  method: number
  compSize: number
  uncompSize: number
  localHeaderOffset: number
}

function findEndOfCentralDir(buf: Uint8Array): number {
  // EOCD signature 0x06054b50，从尾部扫描
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const min = Math.max(0, buf.length - 0x10000 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(view, i) === 0x06054b50) return i
  }
  throw new Error('无效的 ZIP：找不到中央目录')
}

function readCentralDirectory(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const eocd = findEndOfCentralDir(buf)
  const count = u16(view, eocd + 10)
  let offset = u32(view, eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (u32(view, offset) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = u16(view, offset + 10)
    const compSize = u32(view, offset + 20)
    const uncompSize = u32(view, offset + 24)
    const nameLen = u16(view, offset + 28)
    const extraLen = u16(view, offset + 30)
    const commentLen = u16(view, offset + 32)
    const localHeaderOffset = u32(view, offset + 42)
    const nameBytes = buf.subarray(offset + 46, offset + 46 + nameLen)
    const name = new TextDecoder('utf-8').decode(nameBytes)
    entries.push({ name, method, compSize, uncompSize, localHeaderOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function readZipFileData(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const off = entry.localHeaderOffset
  if (u32(view, off) !== 0x04034b50) throw new Error(`ZIP 本地头损坏: ${entry.name}`)
  const nameLen = u16(view, off + 26)
  const extraLen = u16(view, off + 28)
  const dataStart = off + 30 + nameLen + extraLen
  const compressed = buf.subarray(dataStart, dataStart + entry.compSize)
  if (entry.method === 0) return compressed
  if (entry.method === 8) return inflateRaw(compressed)
  throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}（${entry.name}）`)
}

export interface ImportIconPackResult {
  meta: SiteIconPackMeta
}

/**
 * 从 ZIP ArrayBuffer 导入图标包（整包替换）
 */
export async function importIconPackFromZip(buffer: ArrayBuffer): Promise<ImportIconPackResult> {
  const buf = new Uint8Array(buffer)
  if (buf.length < 22) throw new Error('文件过小，不是有效 ZIP')

  const entries = readCentralDirectory(buf)
  const icons = new Map<string, string>()
  let packName = '高清 PT 图标包'
  let packVersion: number | string = 1
  let bytes = 0

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const lower = entry.name.replace(/\\/g, '/').toLowerCase()
    if (lower === 'manifest.json' || lower.endsWith('/manifest.json')) {
      try {
        const raw = await readZipFileData(buf, entry)
        const json = JSON.parse(new TextDecoder('utf-8').decode(raw)) as Record<string, unknown>
        if (typeof json.name === 'string' && json.name.trim()) packName = json.name.trim()
        if (json.version != null) packVersion = json.version as number | string
        if (json.format && json.format !== 'mp-site-icons') {
          // 容忍无 format 字段的简单包
        }
      } catch {
        /* 清单损坏时使用默认元数据，继续导入包内有效图标。 */
      }
      continue
    }
    const prefix = normalizeIconPath(entry.name)
    if (!prefix) continue
    const raw = await readZipFileData(buf, entry)
    if (!raw.length) continue
    const dataUrl = bytesToDataUrl(raw, mimeFromName(entry.name))
    icons.set(prefix, dataUrl)
    bytes += dataUrl.length
  }

  if (icons.size === 0) {
    throw new Error('包内未找到图标（需要 icons/*.png 或根目录 *.png）')
  }

  const meta: SiteIconPackMeta = {
    id: META_KEY,
    name: packName,
    version: packVersion,
    count: icons.size,
    importedAt: Date.now(),
    bytes,
    format: 'mp-site-icons',
  }

  const db = await openDb()
  try {
    const tx = db.transaction([STORE_ICONS, STORE_META], 'readwrite')
    const iconStore = tx.objectStore(STORE_ICONS)
    const metaStore = tx.objectStore(STORE_META)
    iconStore.clear()
    metaStore.clear()
    for (const [prefix, dataUrl] of icons) {
      iconStore.put({ prefix, dataUrl } satisfies IconRecord)
    }
    metaStore.put(meta)
    await idbTxDone(tx)
  rebuildAlnumIndex()
  } finally {
    db.close()
  }

  memoryCache.clear()
  for (const [k, v] of icons) memoryCache.set(k, v)
  metaCache = meta
  readyPromise = Promise.resolve()
  return { meta }
}



export function formatIconPackSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
