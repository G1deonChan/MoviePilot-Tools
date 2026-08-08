// MoviePilot Web 智能助手 API、流式会话和本地历史管理。
// 路径前缀：/api/v1/message/agent/*
import { api } from '../core/http'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'
import { getActiveBaseUrl } from '../core/auth-session'
import { getToken } from './auth'

const MAX_PERSISTED_MESSAGES = 30
const MAX_LOCAL_HISTORY_SESSIONS = 120
const HISTORY_TITLE_LENGTH = 36

export type AgentAttachmentKind = 'audio' | 'file' | 'image'

export interface AgentSessionItem {
  sessionId: string
  title: string
  channel?: string
  updatedAt: number
  preview?: string
  /** 本地历史记录可附带当前会话的消息快照。 */
  messages?: AgentChatMessage[]
  clientSessionId?: string
  createdAt?: number
}

export interface AgentPersistedState {
  sessionId: string
  messages: AgentChatMessage[]
}

export interface AgentMessageAttachment {
  kind: AgentAttachmentKind
  url: string
  download_url?: string
  name?: string
  mime_type?: string
  size?: number
  local_path?: string
  ref?: string
  status?: string
}

export interface AgentOutgoingFile {
  ref: string
  name?: string
  mime_type?: string
  size?: number
  local_path?: string
  status?: string
}

export interface AgentPendingAttachment {
  id: string
  file: File
  kind: AgentAttachmentKind
  name: string
  mime_type: string
  size: number
  preview_url?: string
}

export interface PreparedAgentAttachments {
  images: string[]
  files: AgentOutgoingFile[]
  audioRefs: string[]
  userAttachments: AgentMessageAttachment[]
}

export interface AgentSlashCommand {
  command: string
  description: string
  category?: string
  type?: string
  pid?: string
}

export type AgentChoiceStatus = 'pending' | 'selected' | 'expired'

export interface AgentChoiceButton {
  label: string
  callback_data: string
  description?: string
}

export interface AgentChoiceCard {
  id: string
  title?: string
  prompt: string
  buttons: AgentChoiceButton[]
  button_rows?: AgentChoiceButton[][]
  status: AgentChoiceStatus
  selected_label?: string
  selected_value?: string
  selected_description?: string
}

export interface AgentChoiceSelection {
  choice_id: string
  title?: string
  prompt: string
  buttons: AgentChoiceButton[]
  button_rows?: AgentChoiceButton[][]
  selected_label?: string
  selected_value?: string
  selected_description?: string
}

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'done' | 'streaming' | 'error'
  tools: Array<{ id: string; message: string; status: 'running' | 'done' }>
  attachments: AgentMessageAttachment[]
  choices: AgentChoiceCard[]
  choice_selection?: AgentChoiceSelection
  createdAt?: number
}

export interface AgentStreamEvent {
  type: string
  content?: string
  message?: string
  message_i18n?: string
  session_id?: string
  message_id?: string
  attachment?: AgentMessageAttachment
  choice?: Partial<AgentChoiceCard> & {
    id?: string
    prompt?: string
    text?: string
    message?: string
    buttons?: unknown
    button_rows?: unknown
    buttonRows?: unknown
  }
  target_message?: Partial<AgentChatMessage> & { id?: string }
}

export interface AgentCapability {
  enabled: boolean
  message?: string
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

function unwrapData(data: unknown): unknown {
  const root = asRecord(data)
  if (!root) return data
  if ('data' in root) return root.data
  return data
}

function stringify(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeAttachmentKind(raw: unknown): AgentAttachmentKind {
  const k = stringify(raw).toLowerCase()
  if (k === 'image' || k.startsWith('image/')) return 'image'
  if (k === 'audio' || k.startsWith('audio/')) return 'audio'
  return 'file'
}

function normalizeAttachment(raw: unknown): AgentMessageAttachment | null {
  const item = asRecord(raw)
  if (!item) return null
  const url = stringify(item.url || item.download_url || item.ref || item.preview_url)
  if (!url && !stringify(item.ref)) return null
  return {
    kind: normalizeAttachmentKind(item.kind || item.type || item.mime_type),
    url: url || stringify(item.ref),
    download_url: stringify(item.download_url || item.url) || undefined,
    name: stringify(item.name || item.filename) || undefined,
    mime_type: stringify(item.mime_type || item.mimeType || item.content_type) || undefined,
    size: Number(item.size) || undefined,
    local_path: stringify(item.local_path) || undefined,
    ref: stringify(item.ref) || undefined,
    status: stringify(item.status) || undefined,
  }
}

/** 是否开启 Web 智能助手（与 captcha 同一全局开关） */
export async function fetchAgentCapability(): Promise<AgentCapability> {
  try {
    const res = await api.get<Record<string, unknown>>('/api/v1/system/global/user')
    if (!res.ok) {
      return { enabled: false, message: res.error || `HTTP ${res.status}` }
    }
    const payload = (asRecord(res.data)?.data as Record<string, unknown> | undefined) ?? asRecord(res.data) ?? {}
    const enabled = Boolean(payload.AI_AGENT_ENABLE)
    return {
      enabled,
      message: enabled ? undefined : '请在 MoviePilot 系统设置中启用 AI 智能助手。',
    }
  } catch (e) {
    return { enabled: false, message: String(e) }
  }
}

function normalizeSession(raw: unknown): AgentSessionItem | null {
  const item = asRecord(raw)
  if (!item) return null
  const sessionId = stringify(item.session_id ?? item.sessionId ?? item.id)
  if (!sessionId) return null
  const updatedAt = Number(item.updated_at ?? item.updatedAt ?? item.time ?? Date.now()) || Date.now()
  const title =
    stringify(item.title) ||
    stringify(item.name) ||
    stringify(item.preview) ||
    '未命名会话'
  return {
    sessionId,
    title,
    channel: stringify(item.channel) || undefined,
    updatedAt,
    preview: stringify(item.preview || item.last_message || item.content) || undefined,
  }
}

export async function listAgentSessions(page = 1, count = 30): Promise<AgentSessionItem[]> {
  const res = await api.get<unknown>('/api/v1/message/agent/sessions', { page, count })
  if (!res.ok) throw new Error(res.error || `加载会话失败 HTTP ${res.status}`)
  const root = asRecord(res.data)
  if (root && root.success === false) {
    throw new Error(stringify(root.message_i18n || root.message) || '加载会话失败')
  }
  const data = unwrapData(res.data)
  const list = Array.isArray(data) ? data : Array.isArray(asRecord(data)?.items) ? (asRecord(data)!.items as unknown[]) : []
  return list.map(normalizeSession).filter(Boolean) as AgentSessionItem[]
}

function normalizeChoiceButton(value: unknown): AgentChoiceButton | null {
  const item = asRecord(value)
  if (!item) return null
  const callbackData =
    stringify(item.callback_data) ||
    stringify(item.callbackData) ||
    stringify(item.value) ||
    stringify(item.id)
  const label = stringify(item.label) || stringify(item.text) || stringify(item.title) || callbackData
  const description = stringify(item.description) || stringify(item.desc)
  if (!label && !callbackData) return null
  return {
    label: label || callbackData,
    callback_data: callbackData || label,
    ...(description ? { description } : {}),
  }
}

function normalizeChoiceButtonRows(value: unknown): AgentChoiceButton[][] {
  if (!Array.isArray(value)) return []
  const rawRows = value.some(Array.isArray) ? value : value.map((item) => [item])
  return rawRows
    .map((row) => {
      const rowItems = Array.isArray(row) ? row : [row]
      return rowItems.map(normalizeChoiceButton).filter(Boolean) as AgentChoiceButton[]
    })
    .filter((row) => row.length > 0)
}

export function normalizeChoiceCard(value: unknown): AgentChoiceCard | null {
  const item = asRecord(value)
  if (!item) return null
  const snakeCaseRows = normalizeChoiceButtonRows(item.button_rows)
  const camelCaseRows = normalizeChoiceButtonRows(item.buttonRows)
  const flatButtonRows = normalizeChoiceButtonRows(item.buttons)
  const buttonRows =
    snakeCaseRows.length > 0 ? snakeCaseRows : camelCaseRows.length > 0 ? camelCaseRows : flatButtonRows
  const buttons = buttonRows.flat()
  const prompt = stringify(item.prompt) || stringify(item.message) || stringify(item.text)
  const id = stringify(item.id) || createId('choice')
  if (!prompt && buttons.length === 0) return null
  const statusRaw = stringify(item.status).toLowerCase()
  const status: AgentChoiceStatus =
    statusRaw === 'selected' || statusRaw === 'expired' ? statusRaw : 'pending'
  return {
    id,
    title: stringify(item.title) || undefined,
    prompt,
    buttons,
    button_rows: buttonRows,
    status,
    selected_label: stringify(item.selected_label || item.selectedLabel) || undefined,
    selected_value: stringify(item.selected_value || item.selectedValue) || undefined,
    selected_description:
      stringify(item.selected_description || item.selectedDescription) || undefined,
  }
}

export function getChoiceButtonRows(choice: AgentChoiceCard | AgentChoiceSelection): AgentChoiceButton[][] {
  if (Array.isArray(choice.button_rows) && choice.button_rows.length) return choice.button_rows
  return choice.buttons.map((button) => [button])
}

function normalizeHistoryMessage(raw: unknown): AgentChatMessage | null {
  const item = asRecord(raw)
  if (!item) return null
  const roleRaw = stringify(item.role || item.type).toLowerCase()
  const role: AgentChatMessage['role'] =
    roleRaw === 'user' || roleRaw === 'human' ? 'user' : roleRaw === 'system' ? 'system' : 'assistant'
  const content = stringify(item.content ?? item.text ?? item.message ?? '')
  const attachmentsRaw = Array.isArray(item.attachments) ? item.attachments : []
  const attachments = attachmentsRaw.map(normalizeAttachment).filter(Boolean) as AgentMessageAttachment[]
  const choicesRaw = Array.isArray(item.choices) ? item.choices : []
  const choices = choicesRaw.map(normalizeChoiceCard).filter(Boolean) as AgentChoiceCard[]
  if (!content && !attachments.length && !choices.length && role === 'assistant') {
    // 允许空助手占位
  }
  return {
    id: stringify(item.id) || createId('msg'),
    role,
    content,
    status: 'done',
    tools: [],
    attachments,
    choices,
  }
}

export async function getAgentSession(sessionId: string): Promise<{
  sessionId: string
  messages: AgentChatMessage[]
}> {
  const res = await api.get<unknown>(`/api/v1/message/agent/sessions/${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(res.error || `加载会话失败 HTTP ${res.status}`)
  const root = asRecord(res.data)
  if (root && root.success === false) {
    throw new Error(stringify(root.message_i18n || root.message) || '加载会话失败')
  }
  const data = asRecord(unwrapData(res.data)) || root || {}
  const msgsRaw =
    (Array.isArray(data.messages) && data.messages) ||
    (Array.isArray(data.history) && data.history) ||
    (Array.isArray(data.chats) && data.chats) ||
    []
  const messages = (msgsRaw as unknown[]).map(normalizeHistoryMessage).filter(Boolean) as AgentChatMessage[]
  return {
    sessionId: stringify(data.session_id ?? data.sessionId ?? sessionId) || sessionId,
    messages,
  }
}

export async function deleteAgentSession(sessionId: string): Promise<void> {
  const res = await api.del<unknown>(`/api/v1/message/agent/sessions/${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(res.error || `删除失败 HTTP ${res.status}`)
}

export async function stopAgentSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  await api.post(`/api/v1/message/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {})
}

/** 提交消息选择按钮的回调数据。 */
export async function postAgentChoiceCallback(body: {
  session_id?: string | null
  callback_data: string
  original_message_id?: string
  original_chat_id?: string | null
}): Promise<Record<string, unknown>> {
  const res = await api.post<unknown>('/api/v1/message/agent/callback', {
    session_id: body.session_id || null,
    callback_data: body.callback_data,
    original_message_id: body.original_message_id,
    original_chat_id: body.original_chat_id || body.session_id || null,
  })
  if (!res.ok) throw new Error(res.error || `选择失败 HTTP ${res.status}`)
  const root = asRecord(res.data)
  if (root && root.success === false) {
    throw new Error(stringify(root.message_i18n || root.message) || '该选择已失效，请重新发起')
  }
  return (asRecord(unwrapData(res.data)) || root || {}) as Record<string, unknown>
}


/** 斜杠命令列表 */
export async function listAgentCommands(): Promise<AgentSlashCommand[]> {
  const res = await api.get<unknown>('/api/v1/message/agent/commands')
  if (!res.ok) throw new Error(res.error || `命令列表加载失败 HTTP ${res.status}`)
  const root = asRecord(res.data)
  if (root && root.success === false) {
    throw new Error(stringify(root.message_i18n || root.message) || '命令列表加载失败')
  }
  const data = unwrapData(res.data)
  const list = Array.isArray(data) ? data : []
  return list
    .map((raw) => {
      const item = asRecord(raw) || {}
      return {
        command: stringify(item.command),
        description: stringify(item.description),
        category: stringify(item.category) || undefined,
        type: stringify(item.type) || undefined,
        pid: stringify(item.pid) || undefined,
      }
    })
    .filter((item) => item.command.startsWith('/'))
}

/** 拼接附件地址（相对路径补 baseUrl） */
export async function resolveAgentMediaUrl(url?: string): Promise<string> {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  const base = (await getActiveBaseUrl()) || ''
  if (!base) return url
  try {
    if (url.startsWith('/')) return new URL(url, base).toString()
    return new URL(url, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return url
  }
}

export function getFileKind(file: File): AgentAttachmentKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function formatAttachmentSize(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('附件读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 上传智能助手附件 */
export async function uploadAgentAttachment(
  file: File,
  sessionId?: string | null,
): Promise<AgentMessageAttachment & AgentOutgoingFile> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('session_id', sessionId || '')

  const res = await api.post<unknown>('/api/v1/message/agent/upload', formData)
  if (!res.ok) throw new Error(res.error || `附件上传失败 HTTP ${res.status}`)
  const root = asRecord(res.data)
  if (root && root.success === false) {
    throw new Error(stringify(root.message_i18n || root.message) || '附件上传失败')
  }
  const data = asRecord(unwrapData(res.data)) || root || {}
  const kind = getFileKind(file)
  const url = stringify(data.url || data.download_url || data.ref)
  const ref = stringify(data.ref || data.url || url)
  if (!ref && !url) throw new Error('附件上传失败：无引用')
  return {
    kind: normalizeAttachmentKind(data.kind) || kind,
    url: url || ref,
    download_url: stringify(data.download_url || data.url) || undefined,
    name: stringify(data.name) || file.name,
    mime_type: stringify(data.mime_type) || file.type || 'application/octet-stream',
    size: Number(data.size) || file.size,
    local_path: stringify(data.local_path) || undefined,
    ref: ref || url,
    status: stringify(data.status) || 'ready',
  }
}

/** 准备本轮 images / files / audio_refs / 本地展示附件 */
export async function prepareAgentAttachments(
  items: AgentPendingAttachment[],
  sessionId?: string | null,
): Promise<PreparedAgentAttachments> {
  const images: string[] = []
  const files: AgentOutgoingFile[] = []
  const audioRefs: string[] = []
  const userAttachments: AgentMessageAttachment[] = []

  for (const item of items) {
    const imageDataUrl = item.kind === 'image' ? await readFileAsDataUrl(item.file) : ''
    const uploaded = await uploadAgentAttachment(item.file, sessionId)
    const displayAttachment: AgentMessageAttachment = {
      kind: item.kind,
      url: item.kind === 'image' ? imageDataUrl : uploaded.url,
      download_url: uploaded.download_url || uploaded.url,
      name: item.name,
      mime_type: item.mime_type,
      size: item.size,
    }
    if (imageDataUrl) images.push(imageDataUrl)
    const outgoing: AgentOutgoingFile = {
      ref: uploaded.ref || uploaded.url,
      name: uploaded.name || item.name,
      mime_type: uploaded.mime_type || item.mime_type,
      size: uploaded.size || item.size,
      local_path: uploaded.local_path,
      status: uploaded.status || 'ready',
    }
    if (item.kind === 'audio') audioRefs.push(outgoing.ref)
    else files.push(outgoing)
    userAttachments.push(displayAttachment)
  }

  return { images, files, audioRefs, userAttachments }
}

export type StreamHandlers = {
  onEvent: (event: AgentStreamEvent) => void
  signal?: AbortSignal
}

/** SSE 流式对话 */
export async function streamAgentChat(
  body: {
    text: string
    display_text?: string
    session_id?: string | null
    images?: string[]
    files?: AgentOutgoingFile[] | unknown[]
    audio_refs?: string[]
    echo_user?: boolean
  },
  handlers: StreamHandlers,
): Promise<void> {
  const base = (await getActiveBaseUrl()) || ''
  if (!base) throw new Error('未配置服务器地址')
  const token = await getToken()
  const url = new URL('/api/v1/message/agent/stream', base)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (token) headers.Authorization = `Bearer ${token.replace(/^Bearer\s+/i, '').trim()}`

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: body.text,
      display_text: body.display_text ?? body.text,
      session_id: body.session_id || null,
      images: body.images || [],
      files: body.files || [],
      audio_refs: body.audio_refs || [],
      echo_user: body.echo_user !== false,
    }),
    signal: handlers.signal,
  })

  if (!response.ok) {
    let msg = `HTTP ${response.status}`
    try {
      const t = await response.text()
      try {
        const j = JSON.parse(t) as { message?: string; message_i18n?: string; detail?: string }
        msg = j.message_i18n || j.message || j.detail || msg
      } catch {
        if (t) msg = t.slice(0, 200)
      }
    } catch {
      /* 响应正文读取失败时保留 HTTP 状态错误。 */
    }
    throw new Error(msg)
  }
  if (!response.body) throw new Error('无流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const parseBlock = (block: string): AgentStreamEvent | null => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return null
    try {
      return JSON.parse(data) as AgentStreamEvent
    } catch {
      return null
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\n\n/)
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const event = parseBlock(block)
      if (event) handlers.onEvent(event)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseBlock(buffer)
    if (event) handlers.onEvent(event)
  }
}

/** 创建 Web 智能助手本地会话 ID。 */
export function createAgentSessionId(): string {
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function truncateHistoryText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trim()}...`
}

function getMessageSummaryText(message: AgentChatMessage): string {
  const text = (message.content || '').replace(/\s+/g, ' ').trim()
  if (text) return text
  const firstAttachment = message.attachments?.[0]
  if (firstAttachment) return firstAttachment.name || '附件消息'
  return ''
}

export function buildAgentSessionHistoryTitle(sessionMessages: AgentChatMessage[]): string {
  const firstUser = sessionMessages.find((m) => m.role === 'user' && getMessageSummaryText(m))
  const firstReadable = firstUser || sessionMessages.find((m) => getMessageSummaryText(m))
  const title = firstReadable ? getMessageSummaryText(firstReadable) : ''
  return truncateHistoryText(title || '未命名会话', HISTORY_TITLE_LENGTH)
}

/** 规范化可安全写入本地历史的消息数据。 */
export function normalizeStoredAgentMessages(value: unknown): AgentChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(-MAX_PERSISTED_MESSAGES).map((rawMessage) => {
    const message = asRecord(rawMessage) || {}
    const roleRaw = stringify(message.role).toLowerCase()
    const role: AgentChatMessage['role'] =
      roleRaw === 'user' || roleRaw === 'human' ? 'user' : roleRaw === 'system' ? 'system' : 'assistant'
    const statusRaw = stringify(message.status).toLowerCase()
    const status: AgentChatMessage['status'] =
      statusRaw === 'streaming' || statusRaw === 'error' ? statusRaw : 'done'
    const attachmentsRaw = Array.isArray(message.attachments) ? message.attachments : []
    const attachments = attachmentsRaw.map(normalizeAttachment).filter(Boolean) as AgentMessageAttachment[]
    const choicesRaw = Array.isArray(message.choices) ? message.choices : []
    const choices = choicesRaw.map(normalizeChoiceCard).filter(Boolean) as AgentChoiceCard[]
    const toolsRaw = Array.isArray(message.tools) ? message.tools : []
    const tools = toolsRaw
      .map((t) => {
        const item = asRecord(t)
        if (!item) return null
        return {
          id: stringify(item.id) || createId('tool'),
          message: stringify(item.message) || '工具调用',
          status: stringify(item.status) === 'running' ? ('running' as const) : ('done' as const),
        }
      })
      .filter(Boolean) as AgentChatMessage['tools']
    return {
      id: stringify(message.id) || createId(role),
      role,
      content: typeof message.content === 'string' ? message.content : stringify(message.content),
      status,
      tools,
      attachments,
      choices,
      createdAt: Number(message.createdAt || message.created_at) || Date.now(),
    }
  })
}

function normalizeLocalHistorySessions(value: unknown): AgentSessionItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const rec = asRecord(item)
      if (!rec) return null
      const messages = normalizeStoredAgentMessages(rec.messages)
      const sessionIdValue = stringify(rec.sessionId || rec.session_id)
      if (!sessionIdValue || (messages.length === 0 && !stringify(rec.title) && !stringify(rec.preview))) {
        return null
      }
      const firstMessageTime = messages[0]?.createdAt || Date.now()
      const lastMessageTime = messages.at(-1)?.createdAt || firstMessageTime
      return {
        sessionId: sessionIdValue,
        clientSessionId: stringify(rec.clientSessionId) || undefined,
        title:
          stringify(rec.title).trim() ||
          (messages.length ? buildAgentSessionHistoryTitle(messages) : '未命名会话'),
        preview: stringify(rec.preview) || undefined,
        channel: stringify(rec.channel) || undefined,
        createdAt: Number(rec.createdAt) || firstMessageTime,
        updatedAt: Number(rec.updatedAt || rec.updated_at) || lastMessageTime,
        messages,
      } satisfies AgentSessionItem
    })
    .filter(Boolean)
    .sort((a, b) => (b!.updatedAt || 0) - (a!.updatedAt || 0))
    .slice(0, MAX_LOCAL_HISTORY_SESSIONS) as AgentSessionItem[]
}

/** 读取本地当前会话 */
export async function loadAgentPersistedState(): Promise<AgentPersistedState | null> {
  try {
    const state = (await getPrivateStore()).agent?.state as AgentPersistedState | undefined
    if (!state || typeof state !== 'object') return null
    const sessionId = stringify(state.sessionId)
    if (!sessionId) return null
    return {
      sessionId,
      messages: normalizeStoredAgentMessages(state.messages),
    }
  } catch {
    return null
  }
}

/** 持久化当前会话 */
export async function saveAgentPersistedState(
  sessionId: string | null | undefined,
  messages: AgentChatMessage[],
): Promise<void> {
  if (!sessionId) return
  try {
    const payload: AgentPersistedState = {
      sessionId,
      messages: normalizeStoredAgentMessages(messages).slice(-MAX_PERSISTED_MESSAGES),
    }
    await updatePrivateStore((draft) => {
      draft.agent = { ...(draft.agent || {}), state: payload }
    })
  } catch {
    /* 当前会话状态写入失败不阻断正在进行的对话。 */
  }
}

/** 读取本地历史索引 */
export async function loadAgentLocalHistory(): Promise<AgentSessionItem[]> {
  try {
    return normalizeLocalHistorySessions((await getPrivateStore()).agent?.history)
  } catch {
    return []
  }
}

/** 写入本地历史索引 */
export async function saveAgentLocalHistory(sessions: AgentSessionItem[]): Promise<AgentSessionItem[]> {
  const next = normalizeLocalHistorySessions(sessions).slice(0, MAX_LOCAL_HISTORY_SESSIONS)
  try {
    await updatePrivateStore((draft) => {
      draft.agent = { ...(draft.agent || {}), history: next }
    })
    return next
  } catch {
    const half = next.slice(0, Math.max(1, Math.ceil(next.length / 2)))
    try {
      await updatePrivateStore((draft) => {
        draft.agent = { ...(draft.agent || {}), history: half }
      })
      return half
    } catch {
      return half
    }
  }
}

/** 将当前会话新增或更新到本地历史列表。 */
export async function upsertAgentLocalHistorySession(
  sessionId: string | null | undefined,
  messages: AgentChatMessage[],
  existing: AgentSessionItem[] = [],
): Promise<AgentSessionItem[]> {
  if (!sessionId || !messages.length) return existing
  const storedMessages = normalizeStoredAgentMessages(messages)
  if (!storedMessages.length) return existing
  const prev = existing.find((item) => item.sessionId === sessionId)
  const createdAt = prev?.createdAt || storedMessages[0]?.createdAt || Date.now()
  const updatedAt = storedMessages.at(-1)?.createdAt || Date.now()
  const nextSession: AgentSessionItem = {
    sessionId,
    clientSessionId: prev?.clientSessionId || sessionId,
    title: buildAgentSessionHistoryTitle(storedMessages),
    preview: getMessageSummaryText(storedMessages[storedMessages.length - 1]!) || prev?.preview,
    channel: prev?.channel || 'WebAgent',
    createdAt,
    updatedAt,
    messages: storedMessages,
  }
  const merged = [nextSession, ...existing.filter((item) => item.sessionId !== sessionId)]
  return saveAgentLocalHistory(merged)
}

/** 合并服务端历史与本地历史（服务端优先，本地补全带 messages 的快照） */
export function mergeAgentHistorySessions(
  serverSessions: AgentSessionItem[],
  localSessions: AgentSessionItem[],
): AgentSessionItem[] {
  const map = new Map<string, AgentSessionItem>()
  for (const s of localSessions) {
    if (s.sessionId) map.set(s.sessionId, s)
  }
  for (const s of serverSessions) {
    const prev = map.get(s.sessionId)
    map.set(s.sessionId, {
      ...prev,
      ...s,
      // 服务端列表通常不带 messages，保留本地快照便于离线恢复
      messages: s.messages?.length ? s.messages : prev?.messages,
      title: s.title || prev?.title || '未命名会话',
      updatedAt: Math.max(s.updatedAt || 0, prev?.updatedAt || 0),
    })
  }
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export { createId }
