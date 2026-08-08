// 从二维码图片或页面 otpauth 链接解析 TOTP 密钥。
import jsQR from 'jsqr'
import { parseOtpauthUri } from './totp'

export interface QrParseResult {
  secret: string
  name?: string
  domain?: string
  url?: string
  issuer?: string
}

export function decodeName(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 解析 otpauth 文本或裸 secret，返回可填表单结果 */
export function parseQrPayload(raw: string): QrParseResult | null {
  const text = (raw || '').trim()
  if (!text) return null

  if (/^otpauth:\/\//i.test(text)) {
    const draft = parseOtpauthUri(text)
    if (!draft?.secret) return null
    return {
      secret: draft.secret,
      name: draft.name,
      domain: draft.domain,
      url: draft.url,
      issuer: draft.domain,
    }
  }

  // 部分站点二维码直接是 Base32 secret
  const secret = text.replace(/\s/g, '').toUpperCase()
  if (/^[A-Z2-7]+=*$/.test(secret) && secret.replace(/=+$/, '').length >= 16) {
    return { secret }
  }
  return null
}

/** 从 ImageData 解码二维码文本 */
export function decodeQrFromImageData(imageData: ImageData): string | null {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })
  return code?.data?.trim() || null
}

/** dataURL / 图片 URL → ImageData */
export async function loadImageData(src: string): Promise<ImageData> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export async function decodeQrFromImageSrc(src: string): Promise<string | null> {
  try {
    const imageData = await loadImageData(src)
    return decodeQrFromImageData(imageData)
  } catch {
    return null
  }
}

export async function parseQrFromImageSrc(src: string): Promise<QrParseResult | null> {
  const raw = await decodeQrFromImageSrc(src)
  if (!raw) return null
  return parseQrPayload(raw)
}

type PageScanResult =
  | { type: 'otpauth'; data: string }
  | { type: 'image'; data: string }
  | { type: 'image-url'; data: string }
  | null

/** 浏览器/扩展内部页，无法注入脚本识别二维码 */
export function isRestrictedTabUrl(url?: string | null): boolean {
  if (!url) return true
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|safari-web-extension):/i.test(
    url,
  )
}

/** 是否可作为扫码目标的 http(s) 页面 */
export function isScannableTabUrl(url?: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

/**
 * 解析活动标签页：侧栏/popup 场景下 currentWindow 可能是扩展页本身，
 * 需回退到 lastFocusedWindow 的活动标签。
 */
export async function resolveActivePageTab(): Promise<chrome.tabs.Tab> {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !isScannableTabUrl(tab.url)) {
    ;[tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  }
  // 再兜底：当前窗口所有标签里找最近的 http(s) 活动页
  if (!tab?.id || !isScannableTabUrl(tab.url)) {
    const focused = await chrome.tabs.query({ active: true })
    tab = focused.find((t) => isScannableTabUrl(t.url)) || tab
  }
  if (!tab?.id) throw new Error('未找到活动标签页')
  if (isRestrictedTabUrl(tab.url) || !isScannableTabUrl(tab.url)) {
    throw new Error('当前标签页为浏览器内部页，无法识别二维码。请先打开含二维码的 http/https 站点页面后再点「获取」')
  }
  return tab
}

/** 在当前活动标签页中提取 otpauth 链接或二维码图片。 */
export async function extractQrFromActiveTab(): Promise<{
  pageOrigin?: string
  result: PageScanResult
}> {
  const tab = await resolveActivePageTab()

  let pageOrigin: string | undefined
  try {
    if (tab.url) pageOrigin = new URL(tab.url).origin
  } catch {
    /* 页面 URL 无法解析时仍继续扫描二维码内容。 */
  }

  let execResult: chrome.scripting.InjectionResult | undefined
  try {
    ;[execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: () => {
        const link = Array.from(document.querySelectorAll('a[href^="otpauth://"]'))[0] as
          | HTMLAnchorElement
          | undefined
        if (link?.href) return { type: 'otpauth' as const, data: link.href }

        const imgs = Array.from(document.images) as HTMLImageElement[]
        const candidates = imgs.filter((img) => {
          const src = (img.currentSrc || img.src || '').toLowerCase()
          const hint = ((img.alt || '') + ' ' + (img.title || '')).toLowerCase()
          const sizeOk =
            (img.naturalWidth || img.width) >= 80 && (img.naturalHeight || img.height) >= 80
          return (
            sizeOk &&
            (src.includes('qr') ||
              src.includes('qrcode') ||
              src.includes('otp') ||
              hint.includes('qr') ||
              hint.includes('otp'))
          )
        })
        const targetImg =
          candidates[0] ||
          imgs.find((i) => (i.naturalWidth || i.width) > 100 && (i.naturalHeight || i.height) > 100)
        if (targetImg) {
          try {
            const canvas = document.createElement('canvas')
            const w = targetImg.naturalWidth || targetImg.width
            const h = targetImg.naturalHeight || targetImg.height
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(targetImg, 0, 0, w, h)
              const dataUrl = canvas.toDataURL('image/png')
              return { type: 'image' as const, data: dataUrl }
            }
          } catch {
            const url = (targetImg.currentSrc || targetImg.src || '').trim()
            if (url) return { type: 'image-url' as const, data: url }
          }
          const url = (targetImg.currentSrc || targetImg.src || '').trim()
          if (url) return { type: 'image-url' as const, data: url }
        }

        const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]
        for (const c of canvases) {
          try {
            if (c.width >= 80 && c.height >= 80) {
              const dataUrl = c.toDataURL('image/png')
              if (dataUrl && dataUrl.startsWith('data:image')) {
                return { type: 'image' as const, data: dataUrl }
              }
            }
          } catch {
            /* Canvas 像素不可读时继续扫描其他二维码候选。 */
          }
        }

        const nodes = Array.from(document.querySelectorAll('*')) as HTMLElement[]
        for (const el of nodes) {
          const bg = getComputedStyle(el).backgroundImage || ''
          const m = bg.match(/url\(("|')?(.*?)("|')?\)/)
          if (m?.[2]) {
            const url = m[2]
            const lower = url.toLowerCase()
            if (lower.includes('qr') || lower.includes('qrcode')) {
              return { type: 'image-url' as const, data: url }
            }
          }
        }
        return null
      },
    })
  } catch (e) {
    const msg = String(e || '')
    if (
      /Cannot access chrome:\/\/|Cannot access edge:\/\/|cannot be scripted|Extension manifest must request permission/i.test(
        msg,
      )
    ) {
      throw new Error(
        '当前标签页为浏览器内部页，无法识别二维码。请先打开含二维码的 http/https 站点页面后再点「获取」',
      )
    }
    throw e instanceof Error ? e : new Error(msg)
  }

  return {
    pageOrigin,
    result: (execResult?.result as PageScanResult) ?? null,
  }
}

/** 将远程图片 URL 转为 dataURL（尽量走扩展权限） */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const resp = await fetch(url, { mode: 'cors' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const blob = await resp.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}
