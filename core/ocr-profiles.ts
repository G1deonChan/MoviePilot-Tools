// OCR 预处理 / CTC 解码预设（纯函数，可单测）
// 默认识别配置为 ddddocr，模型文件通常命名为 common.onnx。
// `ppocr_rec` 使用 RGB 高 48、ImageNet 归一化与末位 blank 的 CTC logits。

export type OcrProfileId = 'ddddocr' | 'ppocr_rec'

export interface PreprocessResult {
  data: Float32Array
  dims: [number, number, number, number]
  /** 写入 feeds 的输入名；空则用 session.inputNames[0] */
  inputName?: string
}

export interface OcrProfileMeta {
  id: OcrProfileId
  label: string
  desc: string
  /** blank 在 labels 中的约定：ddddocr 为 index 0 */
  blankMode: 'index0' | 'last'
}

export const OCR_PROFILE_LIST: OcrProfileMeta[] = [
  {
    id: 'ddddocr',
    label: 'ddddocr / Mieru',
    desc: '灰度高 64，输入 [1,1,64,W]，词表 [0]=blank（旧版 common.onnx）',
    blankMode: 'index0',
  },
  {
    id: 'ppocr_rec',
    label: 'PP-OCR Rec 风格',
    desc: 'RGB 高 48，ImageNet 归一化，输入 [1,3,48,W]，blank=末位',
    blankMode: 'last',
  },
]

export function profileMeta(id: OcrProfileId): OcrProfileMeta {
  return OCR_PROFILE_LIST.find((p) => p.id === id) ?? OCR_PROFILE_LIST[0]
}

/** base64 / dataURL → HTMLImageElement */
export function loadImageEl(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
  })
}

export async function preprocess(
  profile: OcrProfileId,
  imageBase64: string,
): Promise<PreprocessResult> {
  if (profile === 'ppocr_rec') return preprocessPpocrRec(imageBase64)
  return preprocessDdddocr(imageBase64)
}

const COLOR_NOISE_CHROMA = 32
const COLOR_NOISE_RATIO = 0.01
const NEUTRAL_DARK_RATIO = 0.005
const COLOR_TEXT_INK_THRESHOLD = 36

/**
 * 白底黑字验证码常叠加彩色圆块、星形和散点。检测到足量彩色像素时，
 * 白化高色差像素，仅保留低色差的黑/灰字符，并拉伸字符与白底的对比度。
 */
export function suppressColorCaptchaNoise(
  rgba: Uint8ClampedArray,
): Uint8ClampedArray | null {
  const pixelCount = Math.floor(rgba.length / 4)
  if (!pixelCount) return null

  let colored = 0
  let neutralDark = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    if (chroma >= COLOR_NOISE_CHROMA) colored++
    else if (0.2126 * r + 0.7152 * g + 0.0722 * b < 128) neutralDark++
  }
  if (
    colored / pixelCount < COLOR_NOISE_RATIO ||
    neutralDark / pixelCount < NEUTRAL_DARK_RATIO
  ) {
    return null
  }

  const gray = new Uint8ClampedArray(pixelCount)
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const alpha = rgba[i + 3] / 255
    const r = rgba[i] * alpha + 255 * (1 - alpha)
    const g = rgba[i + 1] * alpha + 255 * (1 - alpha)
    const b = rgba[i + 2] * alpha + 255 * (1 - alpha)
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    // 黑字叠在彩色块上时，抗锯齿像素可能略带底色；深色像素仍视为字形保留。
    if (chroma >= COLOR_NOISE_CHROMA && luminance >= 96) {
      gray[p] = 255
      continue
    }
    gray[p] = Math.round(Math.max(0, Math.min(255, ((luminance - 48) * 255) / 160)))
  }
  return gray
}

/**
 * 彩色字符白底验证码：以“偏离白色的最大通道差”提取所有彩色字形，
 * 再删除宽度方向连续但垂直厚度极小的细干扰线。
 */
export function extractColorCaptchaText(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  const pixelCount = width * height
  if (!pixelCount || rgba.length < pixelCount * 4) return null

  let colored = 0
  let neutralDark = 0
  const ink = new Uint8ClampedArray(pixelCount)
  for (let i = 0, p = 0; p < pixelCount; i += 4, p++) {
    const alpha = rgba[i + 3] / 255
    const r = rgba[i] * alpha + 255 * (1 - alpha)
    const g = rgba[i + 1] * alpha + 255 * (1 - alpha)
    const b = rgba[i + 2] * alpha + 255 * (1 - alpha)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const darkness = 255 - min
    if (chroma >= COLOR_NOISE_CHROMA) colored++
    else if (0.2126 * r + 0.7152 * g + 0.0722 * b < 128) neutralDark++
    ink[p] = darkness >= COLOR_TEXT_INK_THRESHOLD ? Math.min(255, darkness * 2) : 0
  }
  if (
    colored / pixelCount < COLOR_NOISE_RATIO ||
    neutralDark / pixelCount >= NEUTRAL_DARK_RATIO
  ) {
    return null
  }

  const gray = new Uint8ClampedArray(pixelCount)
  gray.fill(255)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (!ink[p]) continue
      let verticalNeighbors = 0
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height || dy === 0) continue
        if (ink[ny * width + x]) verticalNeighbors++
      }
      let runStart = x
      let runEnd = x
      while (runStart > 0 && ink[y * width + runStart - 1]) runStart--
      while (runEnd + 1 < width && ink[y * width + runEnd + 1]) runEnd++
      const longHorizontalRun = runEnd - runStart + 1 >= Math.max(4, Math.floor(width * 0.08))
      // 干扰线通常横跨较长距离且只有 1–2px 厚；短字符横笔不能仅因缺少纵向邻接被删除。
      if (longHorizontalRun && verticalNeighbors === 0) continue
      gray[p] = 255 - ink[p]
    }
  }
  return gray
}

/** ddddocr 输入规格：白底、灰度、高 64、除以 255、形状 [1,1,64,W]、输入名 input1。 */
async function preprocessDdddocr(imageBase64: string): Promise<PreprocessResult> {
  const TARGET_H = 64
  const img = await loadImageEl(imageBase64)
  const sw = Math.max(1, img.naturalWidth || img.width)
  const sh = Math.max(1, img.naturalHeight || img.height)
  const tw = Math.max(1, Math.floor((sw * TARGET_H) / sh))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, sw, sh)

  // 黑字彩色干扰图保黑去彩；彩色字符图保留全部字色并去细线；其余使用标准灰度。
  const specialized =
    suppressColorCaptchaNoise(data) ?? extractColorCaptchaText(data, sw, sh)
  const gray = specialized ?? new Uint8ClampedArray(sw * sh)
  if (!specialized) {
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3] / 255
      const r = data[i] * a + 255 * (1 - a)
      const g = data[i + 1] * a + 255 * (1 - a)
      const b = data[i + 2] * a + 255 * (1 - a)
      gray[p] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    }
  }

  const resized = resizeGray(gray, sw, sh, tw, TARGET_H)
  const out = new Float32Array(resized.length)
  for (let i = 0; i < resized.length; i++) out[i] = resized[i] / 255
  return { data: out, dims: [1, 1, TARGET_H, tw], inputName: 'input1' }
}

/** PP-OCR rec 风格：高 48、RGB CHW、ImageNet */
async function preprocessPpocrRec(imageBase64: string): Promise<PreprocessResult> {
  const TARGET_H = 48
  const img = await loadImageEl(imageBase64)
  const sw = Math.max(1, img.naturalWidth || img.width)
  const sh = Math.max(1, img.naturalHeight || img.height)
  const tw = Math.max(1, Math.round((sw / sh) * TARGET_H))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = TARGET_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0, tw, TARGET_H)
  const { data } = ctx.getImageData(0, 0, tw, TARGET_H)

  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const h = TARGET_H
  const w = tw
  const chw = new Float32Array(3 * h * w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = data[i + c] / 255
        chw[c * h * w + y * w + x] = (v - mean[c]) / std[c]
      }
    }
  }
  return { data: chw, dims: [1, 3, h, w] }
}

function resizeGray(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  nw: number,
  nh: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(nw * nh)
  const xr = w / nw
  const yr = h / nh
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const px = x * xr
      const py = y * yr
      const x1 = Math.floor(px)
      const x2 = Math.min(x1 + 1, w - 1)
      const y1 = Math.floor(py)
      const y2 = Math.min(y1 + 1, h - 1)
      const fx = px - x1
      const fy = py - y1
      result[y * nw + x] = Math.round(
        data[y1 * w + x1] * (1 - fx) * (1 - fy) +
          data[y1 * w + x2] * fx * (1 - fy) +
          data[y2 * w + x1] * (1 - fx) * fy +
          data[y2 * w + x2] * fx * fy,
      )
    }
  }
  return result
}

/**
 * CTC 解码
 * - ddddocr：输出常为类别索引序列（非 logits），blank=0，跳过连续重复
 * - ppocr_rec：输出 [T,C] logits，blank=C-1，贪心 argmax
 */
export function ctcDecode(
  profile: OcrProfileId,
  data: Float32Array | Int32Array | BigInt64Array | number[],
  dims: readonly number[],
  labels: string[],
): string {
  if (profile === 'ppocr_rec') return ctcDecodeLogits(data, dims, labels)
  return ctcDecodeIndexSeq(data, labels)
}

/** ddddocr：逐元素索引 + blank=0 */
function ctcDecodeIndexSeq(
  data: Float32Array | Int32Array | BigInt64Array | number[] | Iterable<number | bigint>,
  labels: string[],
): string {
  const result: string[] = []
  let prev = -1
  for (const raw of Array.from(data as Iterable<number | bigint>)) {
    const idx = typeof raw === 'bigint' ? Number(raw) : Math.round(Number(raw))
    if (idx === prev) continue
    prev = idx
    if (idx <= 0 || idx >= labels.length) continue
    const ch = labels[idx]
    if (ch) result.push(ch)
  }
  return result.join('').trim()
}

/** PP-OCR 风格 logits 贪心 */
function ctcDecodeLogits(
  data: Float32Array | Int32Array | BigInt64Array | number[],
  dims: readonly number[],
  labels: string[],
): string {
  const arr = data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>)
  const T = dims[dims.length - 2] ?? dims[1] ?? 1
  const C = dims[dims.length - 1] ?? labels.length + 1
  const blank = C - 1
  let decoded = ''
  let prev = -1
  for (let t = 0; t < T; t++) {
    let best = 0
    let bestVal = -Infinity
    for (let c = 0; c < C; c++) {
      const v = arr[t * C + c]
      if (v > bestVal) {
        bestVal = v
        best = c
      }
    }
    if (best !== blank && best !== prev) {
      decoded += labels[best] ?? ''
    }
    prev = best
  }
  return decoded.trim()
}

/** 将 charset 字符串转为 labels（blank 前置），供简易导入 */
export function charsetToLabels(charset: string): string[] {
  return ['', ...Array.from(charset)]
}

/** 校验词表 */
export function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('词表必须是 JSON 数组')
  const labels = raw.map((x) => String(x ?? ''))
  if (labels.length < 2) throw new Error('词表过短')
  return labels
}
