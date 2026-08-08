// 验证码识别服务：三级降级（本地 Offscreen ONNX / 服务端 OCR / AI）
// content 只做 DOM + 发消息；识别编排仅在 background（避免 Mixed Content / storage 限制）
import { api } from '../core/http'
import { MSG, forwardToOffscreen, sendMessage } from '../core/bus'
import { ensureOffscreenDocument } from '../core/offscreen'
import { STORAGE_KEYS, storageGet, storageSet } from '../core/storage'
import { getActiveBaseUrl } from '../core/auth-session'
import { loadActiveOcrModelForInference } from './ocr-models'
import { getOcrRuntimeStatus } from './ocr-runtime'

export type OcrSource = 'offline' | 'server' | 'ai'

export interface OcrResult {
  /** 应用纠错后的文本（用于填充） */
  text: string
  /** 应用纠错前的原始识别结果（用于学习映射） */
  raw: string
  source: OcrSource
}

export interface CaptchaRecognitionOptions {
  expectedLength?: number
}

export type Corrections = Record<string, string>

export interface CorrectionEntry {
  wrong: string
  right: string
}

/** 加载用户纠错词表 */
export async function loadCorrections(): Promise<Corrections> {
  return (await storageGet<Corrections>(STORAGE_KEYS.OCR_CORRECTIONS)) ?? {}
}
export async function saveCorrections(map: Corrections): Promise<void> {
  await storageSet(STORAGE_KEYS.OCR_CORRECTIONS, map)
}

/** 列表形式（设置页管理用） */
export async function listCorrections(): Promise<CorrectionEntry[]> {
  const map = await loadCorrections()
  return Object.entries(map)
    .filter(([wrong]) => !!wrong)
    .map(([wrong, right]) => ({ wrong, right }))
    .sort((a, b) => a.wrong.localeCompare(b.wrong, 'zh-CN'))
}

/**
 * 写入或更新一条纠错：wrong → right。
 * 键值均经 sanitize 处理为大写字母数字，查询时使用同一规范。
 * 若 wrong === right 则删除该映射（无意义）。
 */
export async function upsertCorrection(wrong: string, right: string): Promise<'added' | 'updated' | 'removed'> {
  const w = sanitizeCaptchaText(wrong)
  const r = sanitizeCaptchaText(right)
  if (!w) throw new Error('识别结果不能为空')
  const map = await loadCorrections()
  if (!r || w === r) {
    if (!(w in map)) return 'removed'
    delete map[w]
    await saveCorrections(map)
    return 'removed'
  }
  const existed = w in map
  map[w] = r
  await saveCorrections(map)
  return existed ? 'updated' : 'added'
}

/** 删除一条纠错 */
export async function removeCorrection(wrong: string): Promise<boolean> {
  const w = sanitizeCaptchaText(wrong)
  if (!w) return false
  const map = await loadCorrections()
  if (!(w in map)) return false
  delete map[w]
  await saveCorrections(map)
  return true
}

/** 应用纠错词表：子串替换（先长后短，减少互相覆盖） */
export function applyCorrections(raw: string, map: Corrections): string {
  let out = raw
  const keys = Object.keys(map).filter(Boolean).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const v = map[k]
    if (v == null) continue
    out = out.split(k).join(v)
  }
  return out
}

interface CorrectionsBackup {
  version: number
  corrections: Corrections
  exportedAt: string
}

/** 导出纠错词表为 JSON 文本（含版本号，供备份/迁移） */
export async function exportCorrections(): Promise<string> {
  const backup: CorrectionsBackup = {
    version: 1,
    corrections: await loadCorrections(),
    exportedAt: new Date().toISOString(),
  }
  return JSON.stringify(backup, null, 2)
}

/** 导入纠错词表 JSON，合并入现有词表（重复项以导入覆盖），返回导入条数 */
export async function importCorrections(json: string): Promise<number> {
  const parsed = JSON.parse(json) as Partial<CorrectionsBackup>
  const incoming = parsed.corrections
  if (!incoming || typeof incoming !== 'object') throw new Error('文件格式不正确')
  const cleaned: Corrections = {}
  for (const [k, v] of Object.entries(incoming)) {
    const wrong = sanitizeCaptchaText(k)
    const right = sanitizeCaptchaText(String(v ?? ''))
    if (!wrong || !right || wrong === right) continue
    cleaned[wrong] = right
  }
  const merged = { ...(await loadCorrections()), ...cleaned }
  await saveCorrections(merged)
  return Object.keys(cleaned).length
}

const DEFAULT_OCR_HOST = 'https://movie-pilot.org'

/**
 * content / popup 主入口：经 background 识别，避免：
 * 1) HTTPS 站点上请求 HTTP OCR_HOST 的 Mixed Content
 * 2) content 侧 wxt/storage 在部分上下文不可用
 */
export async function recognizeCaptcha(
  image: string,
  options: CaptchaRecognitionOptions = {},
): Promise<OcrResult> {
  return sendMessage<OcrResult>(MSG.CAPTCHA_RECOGNIZE, { image, ...options })
}

function normalizeExpectedLength(value: unknown): number | undefined {
  const length = Number(value)
  return Number.isInteger(length) && length >= 3 && length <= 8 ? length : undefined
}

function isUsableCaptchaText(text: string, expectedLength?: number): boolean {
  const cleaned = sanitizeCaptchaText(text)
  if (cleaned.length < 3 || cleaned.length > 8) return false
  return !expectedLength || cleaned.length === expectedLength
}

/** background 内部编排：离线 → 服务端 → AI */
export async function recognizeCaptchaInBackground(
  image: string,
  options: CaptchaRecognitionOptions = {},
): Promise<OcrResult> {
  const expectedLength = normalizeExpectedLength(options.expectedLength)
  const embed = await storageGet<{
    captchaOfflineOcrEnabled?: boolean
    captchaAiAssistEnabled?: boolean
  }>(STORAGE_KEYS.WEB_EMBED_FEATURES)
  const localFlag = await storageGet<boolean>(STORAGE_KEYS.OCR_LOCAL_ENABLED)
  const localEnabled = embed?.captchaOfflineOcrEnabled === true || localFlag === true
  const aiEnabled = embed?.captchaAiAssistEnabled === true
  const errors: string[] = []

  // 启用离线 OCR 时优先本地识别；本地模型缺失时允许继续使用服务端识别。
  // 服务端不可达或识别失败时将原因写入 errors。
  if (localEnabled) {
    try {
      const text = await recognizeOfflineInBackground(image)
      if (isUsableCaptchaText(text, expectedLength)) return finish(text, 'offline')
      errors.push(
        text
          ? `离线 OCR 位数不符（识别 ${sanitizeCaptchaText(text).length} 位，预期 ${expectedLength} 位）`
          : '离线 OCR 结果为空',
      )
    } catch (e) {
      errors.push(`离线 OCR: ${String(e)}`)
    }
  }

  // 服务端 OCR 使用 POST `{ocrHost}/captcha/base64`，请求体字段为 `base64_img`。
  // 在 background 发起，可访问 HTTP 内网 OCR，不受页面 Mixed Content 限制
  try {
    const host = await getOcrHost()
    if (host) {
      const text = await recognizeViaServer(host, image)
      if (text && isUsableCaptchaText(text, expectedLength)) return finish(text, 'server')
      errors.push(
        text
          ? `服务端 OCR 位数不符（识别 ${sanitizeCaptchaText(text).length} 位，预期 ${expectedLength} 位）`
          : `服务端 OCR 无结果 (${host})`,
      )
    } else {
      errors.push('服务端 OCR Host 无效')
    }
  } catch (e) {
    errors.push(`服务端 OCR: ${String(e)}`)
  }

  if (aiEnabled) {
    try {
      const text = await recognizeViaAi(image, expectedLength)
      if (text && isUsableCaptchaText(text, expectedLength)) return finish(text, 'ai')
      errors.push(
        text
          ? `AI 识别位数不符（识别 ${sanitizeCaptchaText(text).length} 位，预期 ${expectedLength} 位）`
          : 'AI 识别结果为空',
      )
    } catch (e) {
      errors.push(`AI: ${String(e)}`)
    }
  } else if (!localEnabled) {
    errors.push('AI 辅助未开启')
  }

  throw new Error(`所有识别方式均失败: ${errors.join(' | ')}`)
}

/**
 * 验证码结果清洗：只保留字母与数字，字母统一大写。
 * ddddocr 词表含大量汉字，模糊图可能误输出汉字；字母大小写混杂时统一大写填充。
 */
export function sanitizeCaptchaText(text: string): string {
  return String(text || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .trim()
}

async function finish(text: string, source: OcrSource): Promise<OcrResult> {
  // raw：清洗后、纠错前（供学习词表）；text：清洗 + 纠错后用于填充
  const cleaned = sanitizeCaptchaText(text)
  const map = await loadCorrections()
  const corrected = sanitizeCaptchaText(applyCorrections(cleaned, map))
  return { text: corrected, raw: cleaned, source }
}

/** 解析 MP 设置返回值（兼容 value / data.value） */
function pickSettingValue(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const root = data as Record<string, unknown>
  const nested = root.data
  const nestedVal =
    nested && typeof nested === 'object'
      ? String((nested as Record<string, unknown>).value ?? '')
      : ''
  return String(root.value ?? nestedVal ?? '').trim()
}

/** 校验 OCR Host（允许局域网 IP；拒绝环回） */
function isValidOcrHost(host: string): boolean {
  try {
    const u = new URL(host)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const blocked = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'])
    if (blocked.has(u.hostname.toLowerCase())) return false
    return true
  } catch {
    return false
  }
}

/** MP 服务端 OCR_HOST 配置；失败时回退官方默认 */
async function getOcrHost(): Promise<string | null> {
  let host = DEFAULT_OCR_HOST
  try {
    const res = await api.get<unknown>('/api/v1/system/setting/OCR_HOST')
    if (res.ok) {
      const v = pickSettingValue(res.data)
      if (v) host = v
    }
  } catch {
    /* 使用默认 */
  }
  host = host.replace(/\/$/, '')
  if (!isValidOcrHost(host)) return null
  return host
}

/**
 * 规范化图片 base64：去掉 data URL 前缀与空白，补齐 padding。
 * MediaSaber / MoviePilot OCR 要求纯 base64，带 data:image 前缀会 400。
 */
function normalizeImageBase64(image: string): string {
  let s = String(image || '').trim()
  if (!s) return ''
  if (/^data:image\//i.test(s)) {
    const comma = s.indexOf(',')
    if (comma >= 0 && /;base64/i.test(s.slice(0, comma))) {
      s = s.slice(comma + 1)
    }
  }
  s = s.replace(/\s+/g, '')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  return s
}

/**
 * 服务端 OCR 公开接口
 * POST {host}/captcha/base64  body: { base64_img: 纯base64 }
 */
async function recognizeViaServer(host: string, image: string): Promise<string | null> {
  const base64Img = normalizeImageBase64(image)
  if (!base64Img) throw new Error('图片 base64 为空')
  const ocrUrl = `${host.replace(/\/$/, '')}/captcha/base64`

  const res = await fetch(ocrUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64_img: base64Img }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* 错误正文读取失败时仍按 HTTP 状态返回识别错误。 */
    }
    throw new Error(`HTTP ${res.status} @ ${ocrUrl}${detail ? ` ${detail}` : ''}`)
  }
  const data = (await res.json()) as { result?: string }
  const text = String(data?.result || '').trim()
  return text || null
}

async function recognizeViaAi(
  image: string,
  expectedLength?: number,
): Promise<string | null> {
  const base = ((await getActiveBaseUrl()) || '').replace(/\/$/, '')
  if (!base) return null

  try {
    const agent = await api.get<Record<string, unknown>>('/api/v1/system/global/user')
    if (agent.ok) {
      const payload = (agent.data as { data?: Record<string, unknown> })?.data ?? agent.data
      const enabled = Boolean((payload as { AI_AGENT_ENABLE?: unknown })?.AI_AGENT_ENABLE)
      if (!enabled) return null
    }
  } catch {
    /* 查询失败时仍尝试调用 */
  }

  const apiToken = ((await storageGet<string>(STORAGE_KEYS.AI_TOKEN)) || '').trim() || 'moviepilot'
  const dataUrl = image.startsWith('data:') ? image : `data:image/png;base64,${image}`
  const aiUrl = `${base}/api/v1/openai/v1/chat/completions`

  const res = await fetch(aiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      model: 'moviepilot-agent',
      user: 'mp-extension-captcha',
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: expectedLength
                ? `请识别图片验证码。验证码严格由 ${expectedLength} 位大写英文字母或数字组成。只返回完整的 ${expectedLength} 位验证码，不要解释，不要添加标点。`
                : '请识别图片验证码。只返回验证码字符本身，不要解释，不要添加标点。验证码通常由3到8位英文字母或数字组成。',
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content?.trim() ?? null
}

/**
 * background 离线识别：
 * 1) 在 SW 校验 storage 清单 + IndexedDB 模型存在
 * 2) 只把 modelId/profile 传给 offscreen，由 offscreen 读 IndexedDB 二进制
 *    （28MB 模型经 sendMessage 会丢失，不能传 modelBytes）
 */
export async function recognizeOfflineInBackground(image: string): Promise<string> {
  // 胶水脚本内置；WASM + 模型需导入离线包 / 分别导入
  const runtime = await getOcrRuntimeStatus()
  if (!runtime.ready) {
    throw new Error(
      `未导入 OCR WASM 运行时${
        runtime.missing.length ? `（缺少 ${runtime.missing.join(' 或 ')}）` : ''
      }。请到设置 → 离线 OCR 导入完整 zip 离线包`,
    )
  }
  const model = await loadActiveOcrModelForInference()
  await ensureOffscreenDocument()
  const text = await forwardToOffscreen<string>(MSG.OFFSCREEN_OCR, {
    image,
    modelId: model.modelId,
    profile: model.profile,
  })
  if (!text) throw new Error('离线 OCR 结果为空')
  return text
}

/** 仅本地：经后台编排 */
export function recognizeLocal(image: string): Promise<string> {
  return sendMessage<string>(MSG.OCR_RECOGNIZE, { image })
}
