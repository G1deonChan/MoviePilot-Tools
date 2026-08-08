// OCR 外置资源：WASM 运行时 + ONNX 模型（IndexedDB）
// 扩展内只内置 ort.min.js + *.mjs 胶水；.wasm / common.onnx / charsets.json 由 zip 导入
import { STORAGE_KEYS, storageGet, storageSet, storageRemove } from '../core/storage'
import { importOcrModel, type OcrProfileId } from './ocr-models'

const DB_NAME = 'mpt2-ocr-assets-v1'
const DB_VERSION = 2
const STORE_RUNTIME = 'runtime'

/** zip / 散文件中可识别的 wasm 文件名 */
export const OCR_WASM_FILE_NAMES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jspi.wasm',
] as const

export type OcrWasmFileName = (typeof OCR_WASM_FILE_NAMES)[number]

/** 至少需要其中一个主 wasm */
const RUNTIME_MIN_WASM: OcrWasmFileName[] = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.wasm',
]

const MAX_FILE_BYTES = 80 * 1024 * 1024
const MAX_ZIP_BYTES = 150 * 1024 * 1024

export interface OcrRuntimeMeta {
  files: { name: string; size: number }[]
  totalSize: number
  importedAt: string
  source?: string
}

export interface OcrRuntimeStatus {
  ready: boolean
  meta: OcrRuntimeMeta | null
  missing: string[]
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function isWasmFileName(name: string): name is OcrWasmFileName {
  const base = basename(name)
  return (OCR_WASM_FILE_NAMES as readonly string[]).includes(base)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models')
      if (!db.objectStoreNames.contains('labels')) db.createObjectStore('labels')
      if (!db.objectStoreNames.contains(STORE_RUNTIME)) db.createObjectStore(STORE_RUNTIME)
    }
  })
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result as T | undefined)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).put(value, key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }),
  )
}

function idbClear(store: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }),
  )
}

function idbKeys(store: string): Promise<string[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).getAllKeys()
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

async function loadMeta(): Promise<OcrRuntimeMeta | null> {
  return (await storageGet<OcrRuntimeMeta>(STORAGE_KEYS.OCR_RUNTIME_META)) ?? null
}

async function saveMeta(meta: OcrRuntimeMeta | null): Promise<void> {
  if (!meta) await storageRemove(STORAGE_KEYS.OCR_RUNTIME_META)
  else await storageSet(STORAGE_KEYS.OCR_RUNTIME_META, meta)
}

function missingMinWasm(have: Set<string>): string[] {
  if (RUNTIME_MIN_WASM.some((f) => have.has(f))) return []
  return [...RUNTIME_MIN_WASM]
}

export async function getOcrRuntimeStatus(): Promise<OcrRuntimeStatus> {
  const meta = await loadMeta()
  const keys = new Set(await idbKeys(STORE_RUNTIME))
  const missing = missingMinWasm(keys)
  return { ready: missing.length === 0, meta, missing }
}

export async function getOcrRuntimeFile(name: string): Promise<ArrayBuffer | null> {
  const buf = await idbGet<ArrayBuffer>(STORE_RUNTIME, basename(name))
  return buf ?? null
}

/** 按现有完整离线包结构导出：WASM + 当前启用 .onnx + charsets.json。 */
export async function exportOcrOfflinePackZip(): Promise<ArrayBuffer | null> {
  const active = await import('./ocr-models').then((m) => m.getActiveOcrModel())
  if (!active) return null
  const { getModelBytes, getModelLabels } = await import('./ocr-models')
  const [model, labels, runtimeKeys] = await Promise.all([
    getModelBytes(active.id),
    getModelLabels(active.id),
    idbKeys(STORE_RUNTIME),
  ])
  if (!model || !labels?.length) return null

  const wasmFiles: { name: string; data: ArrayBuffer }[] = []
  for (const name of runtimeKeys) {
    if (!isWasmFileName(name)) continue
    const data = await idbGet<ArrayBuffer>(STORE_RUNTIME, name)
    if (data) wasmFiles.push({ name, data })
  }
  if (!wasmFiles.length) return null

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const file of wasmFiles) zip.file(file.name, file.data)
  zip.file(`${active.name || 'common'}.onnx`, model)
  zip.file('charsets.json', JSON.stringify(labels, null, 2))
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** offscreen 用：把已导入 wasm 转成 blob URL 映射 */
export async function createOcrWasmBlobUrls(): Promise<{
  urls: Record<string, string>
  revoke: () => void
}> {
  const status = await getOcrRuntimeStatus()
  if (!status.ready) {
    throw new Error(
      `未导入 OCR WASM 运行时${status.missing.length ? `（缺少 ${status.missing.join(' 或 ')}）` : ''}。请导入离线资源 zip。`,
    )
  }
  const keys = await idbKeys(STORE_RUNTIME)
  const urls: Record<string, string> = {}
  for (const key of keys) {
    if (!key.endsWith('.wasm')) continue
    const buf = await idbGet<ArrayBuffer>(STORE_RUNTIME, key)
    if (!buf) continue
    urls[key] = URL.createObjectURL(new Blob([buf], { type: 'application/wasm' }))
  }
  return {
    urls,
    revoke: () => {
      for (const u of Object.values(urls)) {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* 单个 Blob URL 撤销失败不阻断其余资源清理。 */
        }
      }
    },
  }
}

async function putWasmFiles(
  files: { name: string; data: ArrayBuffer }[],
  source: string,
): Promise<OcrRuntimeMeta> {
  const entries: { name: string; size: number }[] = []
  for (const f of files) {
    const name = basename(f.name)
    if (!isWasmFileName(name)) continue
    if (f.data.byteLength > MAX_FILE_BYTES) throw new Error(`${name} 超过大小限制`)
    if (f.data.byteLength < 1024) throw new Error(`${name} 过小，可能无效`)
    await idbPut(STORE_RUNTIME, name, f.data)
    entries.push({ name, size: f.data.byteLength })
  }
  if (!entries.length) {
    throw new Error('未找到 wasm 文件（需要 ort-wasm-simd-threaded*.wasm）')
  }
  const have = new Set(await idbKeys(STORE_RUNTIME))
  const missing = missingMinWasm(have)
  if (missing.length) {
    throw new Error(`WASM 不完整，至少需要：${missing.join(' 或 ')}`)
  }

  const filesMeta: { name: string; size: number }[] = []
  let total = 0
  for (const k of have) {
    const buf = await idbGet<ArrayBuffer>(STORE_RUNTIME, k)
    const size = buf?.byteLength ?? 0
    total += size
    filesMeta.push({ name: k, size })
  }
  const meta: OcrRuntimeMeta = {
    files: filesMeta.sort((a, b) => a.name.localeCompare(b.name)),
    totalSize: total,
    importedAt: new Date().toISOString(),
    source,
  }
  await saveMeta(meta)
  return meta
}

export async function parseOcrOfflinePack(file: File): Promise<{
  wasmFiles: { name: string; data: ArrayBuffer }[]
  modelFile?: { name: string; data: ArrayBuffer }
  labelsFile?: { name: string; text: string }
}> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('压缩包过大（上限约 150MB）')
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const wasmFiles: { name: string; data: ArrayBuffer }[] = []
  let modelFile: { name: string; data: ArrayBuffer } | undefined
  let labelsFile: { name: string; text: string } | undefined

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (!entry || entry.dir) continue
    const name = basename(path)
    if (name.startsWith('.') || name.startsWith('__MACOSX')) continue
    if (isWasmFileName(name)) {
      wasmFiles.push({ name, data: await entry.async('arraybuffer') })
      continue
    }
    if (/\.onnx$/i.test(name)) {
      modelFile = { name, data: await entry.async('arraybuffer') }
      continue
    }
    if (/charset/i.test(name) || name.toLowerCase() === 'charsets.json') {
      labelsFile = { name, text: await entry.async('string') }
    }
  }
  return { wasmFiles, modelFile, labelsFile }
}

/** 导入离线包：必须同时包含 wasm + .onnx + charsets.json */
export async function importOcrOfflinePack(
  file: File,
  profile: OcrProfileId = 'ddddocr',
): Promise<{ runtime: OcrRuntimeMeta; modelName: string }> {
  const parsed = await parseOcrOfflinePack(file)
  if (!parsed.wasmFiles.length) {
    throw new Error('zip 中未找到 wasm。请使用 npm run pack:ocr 生成的完整离线包')
  }
  if (!parsed.modelFile) {
    throw new Error('zip 中未找到 .onnx 模型（如 common.onnx）')
  }
  if (!parsed.labelsFile) {
    throw new Error('zip 中未找到 charsets.json 词表')
  }
  const runtime = await putWasmFiles(parsed.wasmFiles, file.name)
  const meta = await importOcrModel({
    name: parsed.modelFile.name,
    profile,
    modelFile: parsed.modelFile.data,
    labelsFile: new File([parsed.labelsFile.text], parsed.labelsFile.name, {
      type: 'application/json',
    }),
  })
  return { runtime, modelName: meta.name }
}

export async function clearOcrRuntime(): Promise<void> {
  await idbClear(STORE_RUNTIME)
  await saveMeta(null)
}

export function formatRuntimeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
