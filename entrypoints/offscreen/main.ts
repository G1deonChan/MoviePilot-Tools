// Offscreen 离线 OCR：
// - 胶水：扩展内置 ocr/ort.min.js + ort-*.mjs（构建注入，体积小）
// - WASM：IndexedDB runtime → env.wasm.wasmBinary（不把大文件打进扩展）
// - 模型：IndexedDB models/labels（background 只传 modelId/profile）
// Chrome MV3：script-src 'self' + 'wasm-unsafe-eval'，禁止 script-src blob:

import { MSG } from '../../core/bus'
import {
  type OcrProfileId,
  preprocess,
  ctcDecode,
} from '../../core/ocr-profiles'

type OrtTensorData = Float32Array | Int32Array | BigInt64Array | number[]

interface OrtTensor {
  data: OrtTensorData
  dims: number[]
}

interface OrtSession {
  inputNames: string[]
  outputNames: string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

interface OrtRuntime {
  env: {
    wasm: {
      numThreads: number
      simd: boolean
      proxy?: boolean
      wasmPaths: string
      wasmBinary: ArrayBuffer
    }
    logLevel: string
  }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor
  InferenceSession: {
    create(
      modelBytes: Uint8Array,
      options: { executionProviders: string[]; graphOptimizationLevel: string },
    ): Promise<OrtSession>
  }
}

declare global {
  var ort: OrtRuntime | undefined
}

const DB_NAME = 'mpt2-ocr-assets-v1'

const DB_VERSION = 2
const STORE_MODELS = 'models'
const STORE_LABELS = 'labels'
const STORE_RUNTIME = 'runtime'

/** 优先 jsep（ORT 1.17+ 默认路径），否则回退主 wasm */
const PREFERRED_WASM = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jspi.wasm',
] as const

interface ActiveModelPayload {
  modelId?: string
  profile?: OcrProfileId
  image?: string
}

interface SessionCache {
  key: string
  session: OrtSession
  labels: string[]
  profile: OcrProfileId
}

let cache: SessionCache | null = null
let ortReady = false
/** 已选中的 wasm 二进制（会话内复用） */
let wasmBinaryCache: ArrayBuffer | null = null

function getOrt(): OrtRuntime | null {
  return globalThis.ort || null
}

async function waitForOrt(timeoutMs = 15000): Promise<OrtRuntime> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const o = getOrt()
    if (o?.InferenceSession) return o
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('ort.min.js 未加载。请确认扩展包含 ocr/ort.min.js 且 offscreen.html 已引入')
}

/**
 * 从 IndexedDB 取优先 wasm。
 * 当前 onnxruntime-web 的 wasmPaths 支持 string 前缀或 { mjs, wasm }，不支持函数。
 * 用 env.wasm.wasmBinary 注入二进制；mjs 仍走扩展内 ocr/ 前缀。
 */
async function loadPreferredWasmBinary(): Promise<ArrayBuffer> {
  if (wasmBinaryCache) return wasmBinaryCache
  const keys = await idbListKeys(STORE_RUNTIME)
  const wasmKeys = keys.filter((k) => k.endsWith('.wasm'))
  if (!wasmKeys.length) {
    throw new Error(
      '未导入 OCR WASM。请到设置 → 离线 OCR 导入完整 zip 离线包',
    )
  }
  let chosen: string | null = null
  for (const name of PREFERRED_WASM) {
    if (wasmKeys.includes(name)) {
      chosen = name
      break
    }
  }
  if (!chosen) {
    throw new Error(
      `WASM 不完整，至少需要：${PREFERRED_WASM.slice(0, 2).join(' 或 ')}。请重新导入离线包`,
    )
  }
  const buf = await idbGetBuffer(STORE_RUNTIME, chosen)
  if (!buf || buf.byteLength < 1024) {
    throw new Error(`IndexedDB 中 ${chosen} 无效，请重新导入离线包`)
  }
  wasmBinaryCache = buf
  return buf
}

async function ensureOrtEnv(): Promise<OrtRuntime> {
  const o = await waitForOrt()
  if (ortReady) return o
  o.env.wasm.numThreads = 1
  o.env.wasm.simd = true
  try {
    o.env.wasm.proxy = false
  } catch {
    /* 当前 ORT 运行时不支持写入 `proxy` 时使用默认执行模式。 */
  }
  o.env.logLevel = 'error'

  // mjs 胶水：扩展内置；wasm：IndexedDB 二进制
  o.env.wasm.wasmPaths = chrome.runtime.getURL('ocr/')
  o.env.wasm.wasmBinary = await loadPreferredWasmBinary()
  ortReady = true
  return o
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MSG.OFFSCREEN_OCR) {
    recognize(msg.payload)
      .then((t) => sendResponse({ ok: true, data: t }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }
  if (msg?.type === MSG.OFFSCREEN_OCR_RESET_SESSION) {
    cache = null
    // 允许重新从 IDB 拉 wasm（用户重导离线包后）
    wasmBinaryCache = null
    ortReady = false
    sendResponse({ ok: true, data: true })
    return false
  }
  return false
})

async function recognize(payload: unknown): Promise<string> {
  const p = (payload || {}) as ActiveModelPayload
  const image = String(p.image || '')
  if (!image) throw new Error('缺少图片数据')

  const o = await ensureOrtEnv()
  const { session, labels, profile, inputHint } = await ensureSession(p, o)
  const input = await preprocess(profile, image)
  const preferred = input.inputName || inputHint || session.inputNames[0]
  const name = session.inputNames.includes(preferred)
    ? preferred
    : session.inputNames.includes('input1')
      ? 'input1'
      : session.inputNames[0]
  const feeds: Record<string, OrtTensor> = {}
  feeds[name] = new o.Tensor('float32', input.data, input.dims)
  const out = await session.run(feeds)
  const tensor =
    out.output ||
    out[session.outputNames[0]] ||
    out[Object.keys(out)[0]]
  if (!tensor) throw new Error('OCR 输出为空')
  const text = ctcDecode(profile, tensor.data, tensor.dims as number[], labels)
  if (!text) throw new Error('OCR 解码为空（可能图片非验证码或模型不匹配）')
  return text
}

async function ensureSession(
  p: ActiveModelPayload,
  o: OrtRuntime,
): Promise<{
  session: OrtSession
  labels: string[]
  profile: OcrProfileId
  inputHint?: string
}> {
  const active = await resolveActive(p)
  if (cache && cache.key === active.key) {
    return {
      session: cache.session,
      labels: cache.labels,
      profile: cache.profile,
      inputHint: active.profile === 'ddddocr' ? 'input1' : undefined,
    }
  }

  const session = await o.InferenceSession.create(active.modelBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  cache = {
    key: active.key,
    session,
    labels: active.labels,
    profile: active.profile,
  }
  return {
    session,
    labels: active.labels,
    profile: active.profile,
    inputHint: active.profile === 'ddddocr' ? 'input1' : undefined,
  }
}

async function resolveActive(p: ActiveModelPayload): Promise<{
  key: string
  modelBytes: Uint8Array
  labels: string[]
  profile: OcrProfileId
}> {
  const modelId = String(p.modelId || '').trim()
  if (!modelId) {
    throw new Error('未指定模型 ID。请到设置 → 离线 OCR 导入完整 zip 离线包')
  }
  const profile: OcrProfileId = p.profile || 'ddddocr'

  const buf = await idbGetBuffer(STORE_MODELS, modelId)
  if (!buf || buf.byteLength < 1024) {
    throw new Error('IndexedDB 中找不到模型二进制。请重新导入 .onnx + charsets.json')
  }
  const labels = await idbGetJson(STORE_LABELS, modelId)
  if (!labels?.length) {
    throw new Error('IndexedDB 中找不到词表，请重新导入 charsets.json')
  }

  return {
    key: `id:${modelId}`,
    modelBytes: new Uint8Array(buf),
    labels,
    profile,
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_MODELS)) db.createObjectStore(STORE_MODELS)
      if (!db.objectStoreNames.contains(STORE_LABELS)) db.createObjectStore(STORE_LABELS)
      if (!db.objectStoreNames.contains(STORE_RUNTIME)) db.createObjectStore(STORE_RUNTIME)
    }
  })
}

function idbGetBuffer(store: string, key: string): Promise<ArrayBuffer | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}


function idbListKeys(store: string): Promise<string[]> {
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
function idbGetJson(store: string, key: string): Promise<string[] | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result as string[] | undefined)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}
