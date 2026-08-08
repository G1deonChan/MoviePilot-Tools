export interface CaptchaCanvasOptions {
  upscale?: boolean
  createCanvas?: () => HTMLCanvasElement
}

const TRANSPARENT_ALPHA_THRESHOLD = 250
const TRANSPARENT_PIXEL_RATIO = 0.05

/**
 * 透明验证码常用浅色彩字；直接铺白底转灰度会让浅色字符接近背景。
 * 当透明像素占比明显时，改用 Alpha 作为字形强度，输出黑字白底且保留抗锯齿边缘。
 */
export function normalizeTransparentCaptchaPixels(data: Uint8ClampedArray): boolean {
  const pixelCount = Math.floor(data.length / 4)
  if (!pixelCount) return false

  let transparentCount = 0
  let visibleCount = 0
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i]
    if (alpha < TRANSPARENT_ALPHA_THRESHOLD) transparentCount++
    if (alpha > 0) visibleCount++
  }
  if (
    !visibleCount ||
    transparentCount / pixelCount < TRANSPARENT_PIXEL_RATIO
  ) {
    return false
  }

  for (let i = 0; i < data.length; i += 4) {
    const gray = 255 - data[i + 3]
    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
    data[i + 3] = 255
  }
  return true
}

/** 读取页面当前图片像素，不请求图片 URL。 */
export async function captureCaptchaImage(
  image: HTMLImageElement,
  options: CaptchaCanvasOptions = {},
): Promise<string> {
  if (!image.complete && image.decode) await image.decode()

  const width = image.naturalWidth || image.width || image.clientWidth
  const height = image.naturalHeight || image.height || image.clientHeight
  if (width <= 0 || height <= 0) throw new Error('验证码图片尺寸无效')

  const upscale = options.upscale ?? true
  const scale = upscale ? (width < 160 ? 3 : 2) : 1
  const canvas = options.createCanvas?.() || document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建验证码画布')

  // 先保持透明度读取页面当前像素；透明验证码用 Alpha 提取字形，否则再铺白底。
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = !upscale
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  if (normalizeTransparentCaptchaPixels(pixels.data)) {
    context.putImageData(pixels, 0, 0)
  } else {
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.globalCompositeOperation = 'source-over'
  }
  return canvas.toDataURL('image/png')
}
