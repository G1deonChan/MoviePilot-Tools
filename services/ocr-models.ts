// OCR 模型注册：元数据存 chrome.storage，.onnx / 词表存 IndexedDB
// 支持导入自定义 CTC 识别模型，默认使用 ddddocr 配置和 common.onnx 命名。
import { STORAGE_KEYS, storageGet, storageSet } from '../core/storage'
import {
  type OcrProfileId,
  OCR_PROFILE_LIST,
  normalizeLabels,
  charsetToLabels,
} from '../core/ocr-profiles'

const DB_NAME = 'mpt2-ocr-assets-v1'

/** 数据库版本 2 保留 runtime store，以确保已有数据库可以正常升级。 */
const DB_VERSION = 2
const STORE_MODELS = 'models'
const STORE_LABELS = 'labels'
const STORE_RUNTIME = 'runtime'

const MAX_MODEL_BYTES = 40 * 1024 * 1024

export interface OcrModelMeta {
  id: string
  name: string
  profile: OcrProfileId
  /** 模型字节数 */
  size: number
  /** 词表条目数 */
  labelCount: number
  createdAt: string
  /** 是否为内置（预留） */
  builtin?: boolean
}

interface OcrModelCatalog {
  models: OcrModelMeta[]
  activeId: string | null
}

const DEFAULT_CATALOG: OcrModelCatalog = { models: [], activeId: null }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS)
      }
      if (!db.objectStoreNames.contains(STORE_LABELS)) {
        db.createObjectStore(STORE_LABELS)
      }
      if (!db.objectStoreNames.contains(STORE_RUNTIME)) {
        db.createObjectStore(STORE_RUNTIME)
      }
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

function idbDel(store: string, key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).delete(key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }),
  )
}

async function loadCatalog(): Promise<OcrModelCatalog> {
  const raw = await storageGet<OcrModelCatalog>(STORAGE_KEYS.OCR_MODELS)
  if (!raw || !Array.isArray(raw.models)) return { ...DEFAULT_CATALOG, models: [] }
  return {
    models: raw.models,
    activeId: raw.activeId ?? null,
  }
}

async function saveCatalog(cat: OcrModelCatalog): Promise<void> {
  await storageSet(STORAGE_KEYS.OCR_MODELS, cat)
}

export async function listOcrModels(): Promise<OcrModelMeta[]> {
  return (await loadCatalog()).models
}

export async function getActiveOcrModel(): Promise<OcrModelMeta | null> {
  const cat = await loadCatalog()
  if (!cat.activeId) return cat.models[0] ?? null
  return cat.models.find((m) => m.id === cat.activeId) ?? cat.models[0] ?? null
}

export async function setActiveOcrModel(id: string): Promise<void> {
  const cat = await loadCatalog()
  if (!cat.models.some((m) => m.id === id)) throw new Error('模型不存在')
  cat.activeId = id
  await saveCatalog(cat)
}

export async function getModelBytes(id: string): Promise<ArrayBuffer | null> {
  const buf = await idbGet<ArrayBuffer>(STORE_MODELS, id)
  return buf ?? null
}

export async function getModelLabels(id: string): Promise<string[] | null> {
  const labels = await idbGet<string[]>(STORE_LABELS, id)
  return labels ?? null
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ImportOcrModelInput {
  name: string
  profile?: OcrProfileId
  modelFile: File | ArrayBuffer
  /** charsets.json 数组文件，或纯文本字符集 */
  labelsFile?: File | null
  /** 若无 labelsFile，可用 charset 字符串（blank 前置） */
  charset?: string
}

/** 导入用户模型到 IndexedDB，并写入清单 */
export async function importOcrModel(input: ImportOcrModelInput): Promise<OcrModelMeta> {
  const modelBuf =
    input.modelFile instanceof ArrayBuffer
      ? input.modelFile
      : await input.modelFile.arrayBuffer()

  if (modelBuf.byteLength > MAX_MODEL_BYTES) {
    throw new Error(`模型超过大小限制（${MAX_MODEL_BYTES / 1024 / 1024}MB）`)
  }
  if (modelBuf.byteLength < 1024) throw new Error('模型文件过小，可能无效')

  let labels: string[]
  if (input.labelsFile) {
    const text = await input.labelsFile.text()
    const trimmed = text.trim()
    if (trimmed.startsWith('[')) {
      labels = normalizeLabels(JSON.parse(trimmed))
    } else {
      labels = charsetToLabels(trimmed.replace(/\s+/g, ''))
    }
  } else if (input.charset && input.charset.trim()) {
    labels = charsetToLabels(input.charset.trim())
  } else {
    throw new Error('请提供 charsets.json 或字符集')
  }

  // ddddocr 词表要求 [0] 为空 blank
  const profile = input.profile ?? 'ddddocr'
  if (profile === 'ddddocr' && labels[0] !== '') {
    labels = ['', ...labels.filter((x) => x !== '')]
  }

  const id = (await sha256Hex(modelBuf)).slice(0, 16)
  const name =
    (input.name || (input.modelFile instanceof File ? input.modelFile.name : '') || id)
      .replace(/\.onnx$/i, '')
      .trim() || id

  await idbPut(STORE_MODELS, id, modelBuf)
  await idbPut(STORE_LABELS, id, labels)

  const meta: OcrModelMeta = {
    id,
    name,
    profile,
    size: modelBuf.byteLength,
    labelCount: labels.length,
    createdAt: new Date().toISOString(),
  }

  const cat = await loadCatalog()
  const idx = cat.models.findIndex((m) => m.id === id)
  if (idx >= 0) cat.models[idx] = meta
  else cat.models.unshift(meta)
  // 新导入默认启用，避免仅写入清单却无 activeId
  cat.activeId = id
  await saveCatalog(cat)
  return meta
}

/**
 * 供 background 离线推理：校验当前启用模型是否完整。
 * 只返回轻量元数据（modelId/profile），二进制由 offscreen 直接读 IndexedDB，
 * 避免 28MB+ 模型经 chrome.runtime.sendMessage 传输丢失。
 */
export async function loadActiveOcrModelForInference(): Promise<{
  modelId: string
  profile: OcrProfileId
}> {
  const active = await getActiveOcrModel()
  if (!active) {
    throw new Error('未导入离线 OCR 模型。请到设置 → 离线 OCR 导入完整 zip 离线包')
  }
  const modelBytes = await getModelBytes(active.id)
  if (!modelBytes || modelBytes.byteLength < 1024) {
    throw new Error('本地模型数据缺失，请重新导入 .onnx')
  }
  const labels = await getModelLabels(active.id)
  if (!labels?.length) {
    throw new Error('模型词表缺失，请重新导入 charsets.json')
  }
  return {
    modelId: active.id,
    profile: active.profile,
  }
}

export async function removeOcrModel(id: string): Promise<void> {
  const cat = await loadCatalog()
  const target = cat.models.find((m) => m.id === id)
  if (target?.builtin) throw new Error('内置模型不可删除')
  cat.models = cat.models.filter((m) => m.id !== id)
  if (cat.activeId === id) cat.activeId = cat.models[0]?.id ?? null
  await saveCatalog(cat)
  await Promise.all([idbDel(STORE_MODELS, id), idbDel(STORE_LABELS, id)])
}

export function formatModelSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export { OCR_PROFILE_LIST }
export type { OcrProfileId }
