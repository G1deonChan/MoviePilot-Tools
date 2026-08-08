// 类型安全消息总线（context:action 命名）
// Popup/Content ↔ Service Worker 经 chrome.runtime 通信
import { addRuntimeMessageListener, isExtensionContextError } from './extension-context'

type Handler = (payload: unknown, sender?: chrome.runtime.MessageSender) => unknown | Promise<unknown>

/** 消息类型常量（避免硬编码字符串） */
export const MSG = {
  PT_OPEN_DOWNLOAD: 'PT_OPEN_DOWNLOAD',
  /** 仅本地 ONNX 推理（background → offscreen） */
  OCR_RECOGNIZE: 'OCR_RECOGNIZE',
  OFFSCREEN_OCR: 'OFFSCREEN_OCR',
  /** popup → background：请求重置当前 OCR 会话 */
  OCR_RESET_SESSION: 'OCR_RESET_SESSION',
  /** background → offscreen：执行 OCR 会话缓存重置 */
  OFFSCREEN_OCR_RESET_SESSION: 'OFFSCREEN_OCR_RESET_SESSION',
  /**
   * content → background：完整验证码识别（离线 / 服务端 / AI）
   * 必须在 background 执行，避免 HTTPS 页面 Mixed Content 与 content 侧 storage 限制
   */
  CAPTCHA_RECOGNIZE: 'CAPTCHA_RECOGNIZE',
  /** content → background：读取站点适配数据，避免 HTTPS 页面直连 HTTP MoviePilot */
  SITE_SUPPORTING_GET: 'SITE_SUPPORTING_GET',
  /** 预留的桥接兼容消息；当前 iframe 握手使用 `MP_IFRAME_NEED_*`，在外部兼容检查完成前保留。 */
  MP_BRIDGE_READY: 'MP_BRIDGE_READY',
  FILL_CREDENTIAL: 'FILL_CREDENTIAL',
  FILL_TOTP: 'FILL_TOTP',
  /** content → background：按域名取解密凭据（需已解锁 / session 可恢复） */
  PT_GET_CRED: 'PT_GET_CRED',
  /** content → background：登录后新增/更新凭据 */
  PT_SAVE_CRED: 'PT_SAVE_CRED',
  /** content → background：加入黑名单（拦截登录填充 + 保存提示） */
  PT_BLOCK_SITE: 'PT_BLOCK_SITE',
  /** content → background：仅拦截该站保存提示 */
  PT_BLOCK_SAVE_PROMPT: 'PT_BLOCK_SAVE_PROMPT',
  /** popup → background：启动远端备份任务 */
  BACKUP_START: 'BACKUP_START',
  /** popup → background：读取当前或最近一次备份任务 */
  BACKUP_GET_STATE: 'BACKUP_GET_STATE',
  /** popup → background：确认已展示备份完成/失败提示 */
  BACKUP_ACKNOWLEDGE: 'BACKUP_ACKNOWLEDGE',
  /** background → popup：备份任务进度或结果更新 */
  BACKUP_JOB_UPDATED: 'BACKUP_JOB_UPDATED',
} as const

const backgroundHandlers = new Map<string, Handler>()

/** 注册后台消息处理器（仅 background 调用） */
export function onMessage(type: string, handler: Handler): void {
  backgroundHandlers.set(type, handler)
}

/** 后台启动消息路由（background 调用一次） */
export function handleRuntimeMessages(): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return
    const handler = backgroundHandlers.get(msg.type)
    if (!handler) return
    Promise.resolve(handler(msg.payload, sender))
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  })
}

/** 后台将消息转发给 Offscreen 文档并取回结果（调用前须 ensureOffscreenDocument） */
export async function forwardToOffscreen<T = unknown>(type: string, payload: unknown): Promise<T> {
  const res = await chrome.runtime.sendMessage({ type, payload })
  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message || 'Offscreen 通信失败')
  }
  if (res && res.ok === false) throw new Error(res.error ?? '未知错误')
  return (res?.data ?? null) as T
}

/** Content 侧消息处理：PT 站交互、凭据填充与 TOTP 填充 */
export function handleContentMessages(_ctx: unknown): void {
  addRuntimeMessageListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false
    // content 无需处理的消息不拦截，交由默认链路
    void sendResponse
    return false
  })
}

/** 发送消息并等待响应 */
export async function sendMessage<T = unknown>(type: string, payload?: unknown): Promise<T> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      throw new Error('Extension context invalidated.')
    }
    const res = await chrome.runtime.sendMessage({ type, payload })
    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message || 'Extension message failed')
    }
    if (res && res.ok === false) throw new Error(res.error ?? '未知错误')
    return (res?.data ?? null) as T
  } catch (e) {
    if (isExtensionContextError(e)) throw new Error('Extension context invalidated.')
    throw e
  }
}

