// 网页内容脚本的功能开关。
// 控制 content script 注入能力：PT 详情下载 / TOTP 填充 / 验证码识别
import { STORAGE_KEYS, storageGet, storageSet } from './storage'

export interface WebEmbedFeaturesConfig {
  /** PT 站点种子详情页一键下载悬浮按钮 */
  torrentDetailDownloadEnabled: boolean
  /** 登录页 TOTP 自动填充 */
  totpAutoFillEnabled: boolean
  /** 登录页图片验证码自动识别填充 */
  captchaAutoFillEnabled: boolean
  /** 离线 OCR（外置 zip：wasm + onnx；offscreen 推理） */
  captchaOfflineOcrEnabled: boolean
  /** AI 辅助识别（MoviePilot OpenAI 兼容接口） */
  captchaAiAssistEnabled: boolean
  /** 打开扩展时恢复上次关闭前的页面 */
  pageKeepEnabled: boolean
}

export const DEFAULT_WEB_EMBED_FEATURES: WebEmbedFeaturesConfig = {
  torrentDetailDownloadEnabled: true,
  totpAutoFillEnabled: false,
  captchaAutoFillEnabled: false,
  captchaOfflineOcrEnabled: false,
  captchaAiAssistEnabled: false,
  pageKeepEnabled: false,
}

export async function getWebEmbedFeaturesConfig(): Promise<WebEmbedFeaturesConfig> {
  const raw = await storageGet<Partial<WebEmbedFeaturesConfig>>(STORAGE_KEYS.WEB_EMBED_FEATURES)
  return {
    ...DEFAULT_WEB_EMBED_FEATURES,
    ...(raw || {}),
  }
}

/**
 * 保存 Web 嵌入配置。
 * 同步 OCR_LOCAL_ENABLED，供 captcha 服务三级降级读取。
 */
export async function saveWebEmbedFeaturesConfig(config: WebEmbedFeaturesConfig): Promise<void> {
  const next: WebEmbedFeaturesConfig = {
    ...DEFAULT_WEB_EMBED_FEATURES,
    ...config,
  }
  await storageSet(STORAGE_KEYS.WEB_EMBED_FEATURES, next)
  await storageSet(STORAGE_KEYS.OCR_LOCAL_ENABLED, !!next.captchaOfflineOcrEnabled)
  if (!next.pageKeepEnabled) await storageSet(STORAGE_KEYS.LAST_VIEW, 'sites')
}
