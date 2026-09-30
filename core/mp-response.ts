/** MoviePilot 普通 JSON 响应适配；直接业务数据和插件协议不强制拆包。 */
export function isMpEnvelope(value: unknown): value is {
  success: boolean
  message: string
  data: unknown
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  return typeof body.success === 'boolean' && typeof body.message === 'string' && 'data' in body
}

/** 空数据的操作结果保留状态；失败结果保留确认信息和校验明细。 */
export function mpPayload(value: unknown): unknown {
  return isMpEnvelope(value) && value.success && value.data != null ? value.data : value
}

/** 同时读取统一错误和 FastAPI detail，不向用户显示对象字符串。 */
export function mpErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback
  const body = value as Record<string, unknown>
  for (const key of ['message_i18n', 'message', 'detail']) {
    if (typeof body[key] === 'string' && body[key].trim()) return body[key].trim()
  }
  return fallback
}
