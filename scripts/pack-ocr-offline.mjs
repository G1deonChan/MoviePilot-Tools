/**
 * 打包 OCR 外置离线资源 zip：
 * - ort-wasm-simd-threaded*.wasm（来自 node_modules/onnxruntime-web）
 * - common.onnx + charsets.json（优先 pack-assets/ocr，可环境变量覆盖）
 *
 * 输出：release/mp-ocr-offline-YYYYMMDD.zip
 * 扩展构建只内置 ort.min.js + *.mjs；此 zip 由用户在设置中导入。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ortDist = path.join(root, 'node_modules/onnxruntime-web/dist')
const outDir = path.join(root, 'release')

const WASM_NAMES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jspi.wasm',
]

function resolveModelDir() {
  if (process.env.OCR_MODEL_DIR) return path.resolve(process.env.OCR_MODEL_DIR)
  const candidates = [
    path.resolve(root, 'pack-assets/ocr/ddddocr-Mieru-OCR'),
    path.resolve(root, 'pack-assets/ocr'),
    path.resolve(root, 'ocr-assets'),
    path.resolve(root, '../MoviePilot-Tools/public/ocr'),
    path.resolve(root, 'public/ocr'),
  ]
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, 'common.onnx')) &&
      fs.existsSync(path.join(c, 'charsets.json'))
    ) {
      return c
    }
  }
  return null
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

async function main() {
  if (!fs.existsSync(ortDist)) {
    console.error('[pack:ocr] 缺少 node_modules/onnxruntime-web，请先 npm install')
    process.exit(1)
  }

  const modelDir = resolveModelDir()
  if (!modelDir) {
    console.error(
      '[pack:ocr] 找不到 common.onnx + charsets.json。\n' +
        '  请放到 pack-assets/ocr/ 或 ocr-assets/，\n' +
        '  或设置环境变量 OCR_MODEL_DIR',
    )
    process.exit(1)
  }

  const zip = new JSZip()
  let wasmCount = 0
  let total = 0

  for (const name of WASM_NAMES) {
    const p = path.join(ortDist, name)
    if (!fs.existsSync(p)) {
      console.warn(`[pack:ocr] skip missing ${name}`)
      continue
    }
    const buf = fs.readFileSync(p)
    zip.file(name, buf)
    wasmCount++
    total += buf.length
    console.log(`[pack:ocr] + ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
  }

  if (wasmCount === 0) {
    console.error('[pack:ocr] 未找到任何 wasm')
    process.exit(1)
  }

  for (const name of ['common.onnx', 'charsets.json']) {
    const p = path.join(modelDir, name)
    const buf = fs.readFileSync(p)
    zip.file(name, buf)
    total += buf.length
    console.log(`[pack:ocr] + ${name} (${(buf.length / 1024 / 1024).toFixed(2)} MB) from ${modelDir}`)
  }

  zip.file(
    'README.txt',
    [
      'MoviePilot Tools OCR 离线资源包',
      '',
      '内容：',
      '  - ort-wasm-simd-threaded*.wasm  ONNX Runtime Web WASM',
      '  - common.onnx                  识别模型',
      '  - charsets.json                词表',
      '',
      '使用：扩展设置 → 本地 OCR → 导入 ZIP',
      '扩展构建仅内置 ort.min.js / *.mjs，不含本包大文件。',
      '',
    ].join('\n'),
  )

  fs.mkdirSync(outDir, { recursive: true })
  const outName = `mp-ocr-offline-${stamp()}.zip`
  const outPath = path.join(outDir, outName)
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  fs.writeFileSync(outPath, content)

  console.log(
    `[pack:ocr] done → ${path.relative(root, outPath)} ` +
      `(raw ~${(total / 1024 / 1024).toFixed(1)} MB, zip ${(content.length / 1024 / 1024).toFixed(1)} MB, wasm×${wasmCount})`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
