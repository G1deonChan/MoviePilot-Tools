<template>
  <div class="agent-root">
    <div v-if="!capability.ready" class="agent-state">
      <div class="agent-state-loading" role="status" aria-live="polite">
        <div class="agent-state-loading__icon" aria-hidden="true">
          <span class="agent-state-spinner" />
        </div>
        <div class="agent-state-loading__title">检查智能助手可用性</div>
        <div class="agent-state-loading__desc">正在连接 MoviePilot…</div>
      </div>
    </div>
    <div v-else-if="!capability.enabled" class="agent-state">
      <div class="agent-state-card agent-state-card--warn">
        <div class="agent-state-title">智能助手未开启</div>
        <div class="agent-state-desc">{{ capability.message || '请在 MoviePilot 系统设置中启用 AI 智能助手。' }}</div>
      </div>
    </div>
    <div v-else class="agent-shell">
      <header class="agent-header">
        <div class="agent-title">
          <div class="agent-title__mark" aria-hidden="true">
            <span class="agent-mini-bot">
              <span class="agent-mini-bot__antenna" />
              <span class="agent-mini-bot__head">
                <span class="agent-mini-bot__face">
                  <span class="agent-mini-bot__eye agent-mini-bot__eye--left" />
                  <span class="agent-mini-bot__eye agent-mini-bot__eye--right" />
                </span>
              </span>
              <span class="agent-mini-bot__body" />
            </span>
          </div>
          <div class="agent-title__text">
            <div class="agent-title__status" :class="{ 'is-busy': sending || recording }">
              {{ statusText }}
            </div>
          </div>
        </div>
        <div class="agent-header-actions">
          <button
            type="button"
            class="agent-icon-btn"
            :class="{ 'is-active': showHistory }"
            title="历史会话"
            :disabled="sending || recording"
            @click="refreshHistory"
          >
            <svg viewBox="0 0 24 24" width="18" height="18"><path :d="mdiHistory" fill="currentColor" /></svg>
          </button>
          <button
            type="button"
            class="agent-icon-btn"
            title="新会话"
            :disabled="sending || recording"
            @click="startNewSession"
          >
            <svg viewBox="0 0 24 24" width="18" height="18"><path :d="mdiMessagePlusOutline" fill="currentColor" /></svg>
          </button>
        </div>
      </header>

      <div v-if="showHistory" class="agent-history">
        <div class="agent-history__header">历史会话</div>
        <div v-if="historyLoading && !sessions.length" class="agent-history__empty">正在加载历史会话…</div>
        <div v-else-if="!sessions.length" class="agent-history__empty">暂无历史会话</div>
        <div v-else class="agent-history__list">
          <div
            v-for="s in sessions"
            :key="s.sessionId"
            class="agent-history-item"
            :class="{ 'is-active': s.sessionId === sessionId }"
          >
            <button
              type="button"
              class="agent-history-item__main"
              :disabled="sending || recording"
              @click="openSession(s.sessionId)"
            >
              <span class="agent-history-item__content">
                <span class="agent-history-item__title">{{ s.title }}</span>
                <span v-if="s.channel" class="agent-history-item__channel">{{ s.channel }}</span>
                <span class="agent-history-item__time">{{ formatTime(s.updatedAt) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="agent-history-item__delete"
              :disabled="sending && s.sessionId === sessionId"
              title="删除历史会话"
              aria-label="删除历史会话"
              @click.stop="deleteHistorySession(s.sessionId)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path :d="mdiDeleteOutline" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <main
        ref="listEl"
        class="agent-messages"
        :class="{ 'has-content': messages.length > 0, 'is-settling': !listSettled }"
      >
        <div class="agent-messages__content">
          <div v-if="!messages.length" class="agent-empty">
            <div class="agent-empty__mark">
              <svg viewBox="0 0 24 24" width="28" height="28"><path :d="mdiCreationOutline" fill="currentColor" /></svg>
            </div>
            <div class="agent-empty__title">今天想处理什么？</div>
            <div class="agent-empty__subtitle">站点、订阅、下载、整理任务，都可以直接问我。</div>
          </div>

          <div
            v-for="m in messages"
            :key="m.id"
            class="agent-message"
            :class="`agent-message--${m.role}`"
          >
            <div class="agent-message__meta">
              <svg v-if="m.role === 'user'" viewBox="0 0 24 24" width="16" height="16">
                <path :d="mdiAccountCircleOutline" fill="currentColor" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="16" height="16">
                <path :d="mdiRobotOutline" fill="currentColor" />
              </svg>
              <span>{{ m.role === 'user' ? '我' : '助手' }}</span>
            </div>

            <div v-if="m.tools.length" class="agent-tools">
              <div v-for="t in m.tools" :key="t.id" class="agent-tool">
                <span class="agent-tool__dot" :class="`is-${t.status}`" />
                <span>{{ t.message }}</span>
              </div>
            </div>

            <div
              v-if="m.content"
              class="agent-message__bubble markdown-body"
              :class="{ 'is-error': m.status === 'error' }"
              v-html="renderMarkdown(m.content)"
            />

            <div v-if="m.choices?.length" class="agent-choices">
              <div v-for="choice in m.choices" :key="choice.id" class="agent-choice">
                <div class="agent-choice__bubble">
                  <div v-if="choice.title" class="agent-choice__title">{{ choice.title }}</div>
                  <div
                    v-if="choice.prompt"
                    class="agent-choice__prompt markdown-body"
                    v-html="renderMarkdown(choice.prompt)"
                  />
                  <div v-if="choice.status === 'selected'" class="agent-choice__selected">
                    <span>已选择：{{ choice.selected_label || choice.selected_description }}</span>
                  </div>
                  <div v-else-if="choice.status === 'expired'" class="agent-choice__selected is-expired">
                    <span>该选择已失效，请重新发起选择</span>
                  </div>
                </div>
                <!-- 选择按钮位于气泡外，按 button_rows 分行，仅 pending 状态可点击。 -->
                <div class="agent-choice__buttons">
                  <div
                    v-for="(row, rowIndex) in getChoiceButtonRows(choice)"
                    :key="`${choice.id}-row-${rowIndex}`"
                    class="agent-choice__button-row"
                  >
                    <button
                      v-for="btn in row"
                      :key="btn.callback_data"
                      type="button"
                      class="agent-choice__button"
                      :disabled="sending || recording || choice.status !== 'pending'"
                      @click="handleChoiceClick(m, choice, btn)"
                    >
                      <span class="agent-choice__button-label">{{ btn.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="m.attachments?.length" class="agent-attachments">
              <div
                v-for="(att, idx) in m.attachments"
                :key="`${m.id}-att-${idx}`"
                class="agent-attachment"
                :class="`agent-attachment--${att.kind}`"
              >
                <img
                  v-if="att.kind === 'image'"
                  class="agent-attachment__image"
                  :src="mediaUrl(att.url)"
                  :alt="att.name || 'image'"
                  loading="lazy"
                />
                <template v-else-if="att.kind === 'audio'">
                  <div class="agent-attachment__meta">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiVolumeHigh" fill="currentColor" /></svg>
                    <span>{{ att.name || '语音' }}</span>
                  </div>
                  <audio class="agent-attachment__audio" controls :src="mediaUrl(att.url)" />
                </template>
                <template v-else>
                  <div class="agent-attachment__file">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path :d="mdiFileOutline" fill="currentColor" /></svg>
                    <div class="agent-attachment__file-text">
                      <span>{{ att.name || '附件' }}</span>
                      <small>{{ att.mime_type || formatAttachmentSize(att.size) }}</small>
                    </div>
                    <a
                      class="agent-attachment__download"
                      :href="mediaUrl(att.download_url || att.url)"
                      :download="att.name || 'attachment'"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="下载"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiDownload" fill="currentColor" /></svg>
                    </a>
                  </div>
                </template>
              </div>
            </div>

            <div
              v-if="m.status === 'streaming' && !m.content && !m.tools.length && !m.attachments?.length && !m.choices?.length"
              class="agent-typing"
              aria-label="思考中"
            >
              <span /><span /><span />
            </div>
          </div>
        </div>
      </main>

      <footer class="agent-composer">
        <div v-if="errorTip" class="agent-alert">{{ errorTip }}</div>

        <div v-if="pendingAttachments.length" class="agent-pending">
          <div v-for="item in pendingAttachments" :key="item.id" class="agent-pending-item">
            <img
              v-if="item.kind === 'image' && item.preview_url"
              class="agent-pending-item__preview"
              :src="item.preview_url"
              :alt="item.name"
            />
            <svg v-else-if="item.kind === 'audio'" viewBox="0 0 24 24" width="18" height="18">
              <path :d="mdiVolumeHigh" fill="currentColor" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18">
              <path :d="mdiFileOutline" fill="currentColor" />
            </svg>
            <div class="agent-pending-item__text">
              <span>{{ item.name }}</span>
              <small>{{ formatAttachmentSize(item.size) || item.mime_type }}</small>
            </div>
            <button
              type="button"
              class="agent-pending-item__remove"
              :disabled="sending"
              title="移除附件"
              @click="removePendingAttachment(item.id)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiClose" fill="currentColor" /></svg>
            </button>
          </div>
        </div>

        <div v-if="showQuickCommandMenu" class="agent-command-menu agent-command-menu--quick">
          <div class="agent-command-menu__scroll">
            <div class="agent-command-menu__tip">系统可用斜杠命令，点选后填入输入框</div>
            <div v-for="group in quickCommandGroups" :key="group.title" class="agent-command-group">
              <div class="agent-command-group__title">{{ group.title }}</div>
              <button
                v-for="command in group.commands"
                :key="command.command"
                type="button"
                class="agent-command"
                :disabled="sending || recording"
                @click="selectQuickCommand(command)"
              >
                <span class="agent-command__name">{{ command.command }}</span>
                <span class="agent-command__desc">{{ command.description }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="showSlashCommandMenu" class="agent-command-menu">
          <div class="agent-command-menu__scroll">
            <button
              v-for="command in filteredSlashCommands"
              :key="command.command"
              type="button"
              class="agent-command"
              @click="selectSlashCommand(command)"
            >
              <span class="agent-command__name">{{ command.command }}</span>
              <span class="agent-command__desc">{{ command.description }}</span>
            </button>
            <div v-if="slashCommandsLoading" class="agent-command is-loading">正在加载命令…</div>
          </div>
        </div>

        <div class="agent-input">
          <button
            type="button"
            class="agent-surface-btn agent-attach-btn"
            :disabled="sending || recording"
            title="选择图片或文件"
            aria-label="选择图片或文件"
            @click="openFilePicker"
          >
            <svg viewBox="0 0 24 24" width="18" height="18"><path :d="mdiPlus" fill="currentColor" /></svg>
          </button>
          <textarea
            ref="inputRef"
            v-model="input"
            class="agent-textarea"
            rows="1"
            :disabled="sending || recording"
            :placeholder="inputPlaceholder"
            @input="handleInputChange"
            @keydown="onKeydown"
          />
          <div class="agent-input-actions">
            <button
              type="button"
              class="agent-surface-btn agent-mic-btn"
              :class="{ 'is-recording': recording }"
              :disabled="!recording && !canRecord"
              :title="recording ? `停止录音（${recordingTimeText}）` : '录制语音'"
              :aria-label="recording ? `停止录音（${recordingTimeText}）` : '录制语音'"
              @click="toggleVoiceRecording"
            >
              <svg v-if="recording" viewBox="0 0 24 24" width="18" height="18">
                <path :d="mdiStopCircleOutline" fill="currentColor" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="18" height="18">
                <path :d="mdiMicrophoneOutline" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              class="agent-surface-btn agent-quick-btn"
              :class="{ 'is-active': showQuickCommands }"
              :disabled="sending || recording"
              title="快捷命令"
              aria-label="快捷命令"
              @click="toggleQuickCommands"
            >
              <svg viewBox="0 0 24 24" width="18" height="18"><path :d="mdiSlashForward" fill="currentColor" /></svg>
            </button>
            <button
              type="button"
              class="agent-surface-btn agent-send-btn"
              :class="{ 'is-stop': sending }"
              :disabled="!sending && !canSend"
              :title="sending ? '停止生成' : '发送'"
              aria-label="发送"
              @click="sending ? stopStream() : send()"
            >
              <svg v-if="sending" viewBox="0 0 24 24" width="17" height="17"><path :d="mdiStop" fill="currentColor" /></svg>
              <svg v-else viewBox="0 0 24 24" width="17" height="17"><path :d="mdiSend" fill="currentColor" /></svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import mila from 'markdown-it-link-attributes'
import {
  mdiAccountCircleOutline,
  mdiClose,
  mdiCreationOutline,
  mdiDeleteOutline,
  mdiDownload,
  mdiFileOutline,
  mdiHistory,
  mdiSlashForward,
  mdiMessagePlusOutline,
  mdiMicrophoneOutline,
  mdiPlus,
  mdiRobotOutline,
  mdiSend,
  mdiStop,
  mdiStopCircleOutline,
  mdiVolumeHigh,
} from '@mdi/js'
import {
  createAgentSessionId,
  createId,
  deleteAgentSession,
  fetchAgentCapability,
  formatAttachmentSize,
  getAgentSession,
  getChoiceButtonRows,
  getFileKind,
  listAgentCommands,
  listAgentSessions,
  loadAgentLocalHistory,
  loadAgentPersistedState,
  mergeAgentHistorySessions,
  normalizeChoiceCard,
  postAgentChoiceCallback,
  prepareAgentAttachments,
  resolveAgentMediaUrl,
  saveAgentLocalHistory,
  saveAgentPersistedState,
  stopAgentSession,
  streamAgentChat,
  upsertAgentLocalHistorySession,
  type AgentChatMessage,
  type AgentChoiceButton,
  type AgentChoiceCard,
  type AgentChoiceSelection,
  type AgentMessageAttachment,
  type AgentPendingAttachment,
  type AgentSessionItem,
  type AgentSlashCommand,
  type AgentStreamEvent,
} from '../services/agent'
import {
  consumePickedPageFiles,
  requestFilesFromActivePage,
  type PickedPageFile,
} from '../core/page-file-picker'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})
md.use(mila, {
  attrs: {
    target: '_blank',
    rel: 'noopener noreferrer',
  },
})

const capability = reactive({ ready: false, enabled: false, message: '' })
const sessions = ref<AgentSessionItem[]>([])
const historyLoading = ref(false)
const showHistory = ref(false)
const messages = ref<AgentChatMessage[]>([])
const sessionId = ref<string | null>(null)
const input = ref('')
const sending = ref(false)
const recording = ref(false)
const recordingStartedAt = ref(0)
const recordingDuration = ref(0)
const errorTip = ref('')
const listEl = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const pendingAttachments = ref<AgentPendingAttachment[]>([])
const slashCommands = ref<AgentSlashCommand[]>([])
const slashCommandsLoading = ref(false)
const slashCommandsLoaded = ref(false)
const showQuickCommands = ref(false)
const mediaUrlCache = reactive<Record<string, string>>({})
const localHistorySessions = ref<AgentSessionItem[]>([])
/** 恢复/切换会话时先隐藏列表，滚到底后再显示，避免顶→底闪烁 */
const listSettled = ref(true)

let streamPersistTimer: number | null = null

/** 智能助手可用的斜杠快捷命令目录。 */
const quickCommandGroups = [
  {
    title: '站点管理',
    commands: [
      { command: '/cookiecloud', description: '同步站点' },
      { command: '/sites', description: '管理站点' },
      { command: '/site_signin', description: '站点签到' },
    ],
  },
  {
    title: '订阅管理',
    commands: [{ command: '/subscribes', description: '管理订阅' }],
  },
  {
    title: '下载与整理',
    commands: [
      { command: '/downloading', description: '正在下载' },
      { command: '/transfer', description: '下载文件整理' },
      { command: '/redo', description: '手动整理' },
    ],
  },
  {
    title: '系统管理',
    commands: [
      { command: '/clear_cache', description: '清理缓存' },
      { command: '/restart', description: '重启系统' },
      { command: '/version', description: '当前版本' },
      { command: '/clear_session', description: '清除会话' },
      { command: '/stop_agent', description: '停止推理' },
      { command: '/mediaserver_sync', description: '同步媒体服务器' },
    ],
  },
  {
    title: '智能体',
    commands: [
      { command: '/session_status', description: '会话状态' },
      { command: '/skills', description: '管理技能' },
    ],
  },
  {
    title: '插件命令',
    commands: [
      { command: '/get_monitored_downloads', description: '插件实时下载量' },
      { command: '/plugin_update', description: '插件更新' },
    ],
  },
] as const

let abortController: AbortController | null = null
let mediaRecorder: MediaRecorder | null = null
let mediaRecorderStream: MediaStream | null = null
let recordingTimer: number | null = null
let recordingChunks: Blob[] = []

const canSend = computed(
  () =>
    (input.value.trim().length > 0 || pendingAttachments.value.length > 0) &&
    !sending.value &&
    !recording.value &&
    capability.enabled,
)
const canRecord = computed(() => !sending.value && !recording.value && capability.enabled)
const inputPlaceholder = computed(() =>
  sending.value ? '智能体正在处理，请稍候...' : '询问 MoviePilot，输入 / 使用命令',
)
const statusText = computed(() => {
  if (recording.value) return `录音中 ${recordingTimeText.value}`
  if (sending.value) return '思考中…'
  return '随时待命'
})
const recordingTimeText = computed(() => {
  const seconds = Math.max(0, recordingDuration.value)
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes}:${String(remainSeconds).padStart(2, '0')}`
})
const slashCommandQuery = computed(() => {
  const text = input.value.trimStart()
  if (!text.startsWith('/')) return ''
  return text.slice(1).toLowerCase()
})
const filteredSlashCommands = computed(() => {
  const query = slashCommandQuery.value
  if (!query) return slashCommands.value
  return slashCommands.value.filter((command) => {
    const haystack = `${command.command} ${command.description} ${command.category || ''}`.toLowerCase()
    return haystack.includes(query)
  })
})
const showSlashCommandMenu = computed(
  () =>
    !showQuickCommands.value &&
    input.value.trimStart().startsWith('/') &&
    !sending.value &&
    !recording.value &&
    (filteredSlashCommands.value.length > 0 || slashCommandsLoading.value),
)
const showQuickCommandMenu = computed(
  () => showQuickCommands.value && !sending.value && !recording.value,
)

function mediaUrl(url?: string): string {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (mediaUrlCache[url]) return mediaUrlCache[url]
  void resolveAgentMediaUrl(url).then((resolved) => {
    mediaUrlCache[url] = resolved || url
  })
  return mediaUrlCache[url] || url
}

function renderMarkdown(value: string): string {
  if (!value) return ''
  try {
    return md.render(value)
  } catch {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  }
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts)
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function scrollToBottom(): void {
  const el = listEl.value
  if (!el) return
  // 瞬时定位，禁用平滑滚动，避免恢复会话时动画闪烁
  el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
}

/** 批量灌入历史消息后：隐藏 → 布局 → 滚底 → 再显示 */
async function settleListAtBottom(): Promise<void> {
  listSettled.value = false
  await nextTick()
  scrollToBottom()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      scrollToBottom()
      requestAnimationFrame(() => {
        scrollToBottom()
        listSettled.value = true
        resolve()
      })
    })
  })
}

function syncInputHeight(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  const next = Math.min(Math.max(el.scrollHeight, 24), 120)
  el.style.height = `${next}px`
  // 仅多行时允许纵向滚动，避免单行右侧滚动条看起来像分割线
  el.classList.toggle('is-expanded', next > 28)
}

function ensureSessionId(): string {
  if (!sessionId.value) sessionId.value = createAgentSessionId()
  return sessionId.value
}

function clearStreamPersistTimer(): void {
  if (streamPersistTimer === null) return
  window.clearTimeout(streamPersistTimer)
  streamPersistTimer = null
}

/** 持久化当前会话状态和本地历史。 */
async function persistState(options: { syncHistory?: boolean } = {}): Promise<void> {
  const { syncHistory = true } = options
  const sid = sessionId.value
  if (!sid) return
  try {
    await saveAgentPersistedState(sid, messages.value)
  } catch {
    /* 当前会话状态保存失败时不中断消息交互。 */
  }
  if (syncHistory && messages.value.length) {
    try {
      localHistorySessions.value = await upsertAgentLocalHistorySession(
        sid,
        messages.value,
        localHistorySessions.value,
      )
    } catch {
      /* 本地历史更新失败时保留当前页面消息。 */
    }
  }
}

function schedulePersistState(delay = 400): void {
  clearStreamPersistTimer()
  streamPersistTimer = window.setTimeout(() => {
    streamPersistTimer = null
    void persistState()
  }, delay)
}

/** 页面挂载时恢复本地历史和当前会话状态。 */
async function restoreLocalAgentState(): Promise<void> {
  localHistorySessions.value = await loadAgentLocalHistory()
  const state = await loadAgentPersistedState()
  if (state?.sessionId) {
    sessionId.value = state.sessionId
    const restored = state.messages || []
    if (restored.length) listSettled.value = false
    messages.value = restored
    if (messages.value.length) {
      localHistorySessions.value = await upsertAgentLocalHistorySession(
        state.sessionId,
        messages.value,
        localHistorySessions.value,
      )
    }
    return
  }
  const latest = localHistorySessions.value[0]
  if (latest?.messages?.length) {
    sessionId.value = latest.sessionId
    listSettled.value = false
    messages.value = latest.messages
    return
  }
  sessionId.value = createAgentSessionId()
  listSettled.value = true
}

function addMessage(
  role: AgentChatMessage['role'],
  content: string,
  status: AgentChatMessage['status'] = 'done',
  attachments: AgentMessageAttachment[] = [],
  choiceSelection?: AgentChoiceSelection,
): AgentChatMessage {
  ensureSessionId()
  const msg: AgentChatMessage = {
    id: createId(role),
    role,
    content,
    status,
    tools: [],
    attachments: [...attachments],
    choices: [],
    choice_selection: choiceSelection,
    createdAt: Date.now(),
  }
  messages.value.push(msg)
  void nextTick(scrollToBottom)
  if (status !== 'streaming') schedulePersistState()
  else schedulePersistState(1000)
  return msg
}

function isEmptyAssistantMessage(message: AgentChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.content &&
    !message.attachments.length &&
    !message.choices.length &&
    !message.tools.length
  )
}

function getChoiceButtonSelectionText(button: AgentChoiceButton): string {
  return button.label || button.description || button.callback_data
}

function buildChoiceSelection(choice: AgentChoiceCard, button: AgentChoiceButton): AgentChoiceSelection {
  return {
    choice_id: choice.id,
    title: choice.title,
    prompt: choice.prompt,
    buttons: [...choice.buttons],
    button_rows: getChoiceButtonRows(choice).map((row) => [...row]),
    selected_label: button.label,
    selected_value: button.callback_data,
    selected_description: getChoiceButtonSelectionText(button),
  }
}

function markChoiceSelected(
  choice: AgentChoiceCard,
  button: AgentChoiceButton,
  selection?: AgentChoiceSelection,
): void {
  choice.status = 'selected'
  choice.selected_label = selection?.selected_label || button.label
  choice.selected_value = selection?.selected_value || button.callback_data
  choice.selected_description = selection?.selected_description || getChoiceButtonSelectionText(button)
}

async function checkCapability(): Promise<void> {
  const cap = await fetchAgentCapability()
  capability.enabled = cap.enabled
  capability.message = cap.message || ''
  capability.ready = true
}

async function refreshHistory(): Promise<void> {
  showHistory.value = !showHistory.value
  if (!showHistory.value) return
  historyLoading.value = true
  try {
    // 先展示本地历史（含消息快照），再合并服务端列表
    localHistorySessions.value = await loadAgentLocalHistory()
    sessions.value = [...localHistorySessions.value]
    try {
      const remote = await listAgentSessions(1, 40)
      sessions.value = mergeAgentHistorySessions(remote, localHistorySessions.value)
      localHistorySessions.value = await saveAgentLocalHistory(sessions.value)
    } catch {
      // 服务端失败时保留本地历史
    }
  } catch (e) {
    errorTip.value = String((e as Error)?.message || e)
  } finally {
    historyLoading.value = false
  }
}

function clearPendingAttachments(): void {
  pendingAttachments.value.forEach((item) => {
    if (item.preview_url) URL.revokeObjectURL(item.preview_url)
  })
  pendingAttachments.value = []
}

function startNewSession(): void {
  stopStream()
  cancelVoiceRecording()
  // 切新会话前落盘当前会话历史
  void persistState()
  sessionId.value = createAgentSessionId()
  messages.value = []
  showHistory.value = false
  showQuickCommands.value = false
  errorTip.value = ''
  input.value = ''
  clearPendingAttachments()
  void saveAgentPersistedState(sessionId.value, [])
  void nextTick(syncInputHeight)
}

async function openSession(id: string): Promise<void> {
  stopStream()
  cancelVoiceRecording()
  errorTip.value = ''
  showQuickCommands.value = false
  clearPendingAttachments()
  void persistState()
  try {
    // 优先本地快照，避免无网/接口慢时空白
    const local = localHistorySessions.value.find((s) => s.sessionId === id)
      || sessions.value.find((s) => s.sessionId === id)
    if (local?.messages?.length) {
      listSettled.value = false
      sessionId.value = local.sessionId
      messages.value = local.messages
      showHistory.value = false
      await persistState({ syncHistory: false })
      await settleListAtBottom()
    }
    try {
      const detail = await getAgentSession(id)
      sessionId.value = detail.sessionId
      // 服务端有消息则覆盖；空详情保留本地快照
      if (detail.messages.length || !messages.value.length) {
        const sameLength = detail.messages.length === messages.value.length
        const sameTail =
          sameLength &&
          (!detail.messages.length ||
            detail.messages[detail.messages.length - 1]?.id ===
              messages.value[messages.value.length - 1]?.id)
        if (!sameTail) {
          listSettled.value = false
          messages.value = detail.messages
          await settleListAtBottom()
        } else if (detail.messages.length) {
          messages.value = detail.messages
        }
      }
      showHistory.value = false
      await persistState()
      if (!listSettled.value) await settleListAtBottom()
    } catch (e) {
      listSettled.value = true
      if (!messages.value.length) {
        errorTip.value = String((e as Error)?.message || e)
      }
    }
  } catch (e) {
    listSettled.value = true
    errorTip.value = String((e as Error)?.message || e)
  }
}

/** 删除历史会话；删当前会话时切到新会话 */
async function deleteHistorySession(targetSessionId: string): Promise<void> {
  if (!targetSessionId) return
  if (sending.value && targetSessionId === sessionId.value) return

  try {
    await deleteAgentSession(targetSessionId)
  } catch {
    // 接口失败时仍清理本地列表，避免坏记录一直占位
  } finally {
    sessions.value = sessions.value.filter((item) => item.sessionId !== targetSessionId)
    localHistorySessions.value = localHistorySessions.value.filter((item) => item.sessionId !== targetSessionId)
    void saveAgentLocalHistory(localHistorySessions.value)
  }

  if (targetSessionId === sessionId.value) startNewSession()
}

function applyMessageUpdate(event: AgentStreamEvent): boolean {
  const target = event.target_message
  const targetId = String(target?.id || event.message_id || '')
  if (!targetId) return false
  const message = messages.value.find((item) => item.id === targetId)
  if (!message || message.role !== 'assistant') return false
  if (typeof target?.content === 'string') message.content = target.content
  if (Array.isArray(target?.attachments)) message.attachments = target.attachments
  if (Array.isArray(target?.tools)) message.tools = target.tools
  if (Array.isArray(target?.choices)) {
    message.choices = target.choices.map(normalizeChoiceCard).filter(Boolean) as AgentChoiceCard[]
  }
  if (target?.status === 'done' || target?.status === 'error' || target?.status === 'streaming') {
    message.status = target.status
  }
  schedulePersistState(200)
  return true
}

function applyStreamEvent(event: AgentStreamEvent, assistant: AgentChatMessage): void {
  switch (event.type) {
    case 'start':
      if (event.session_id) sessionId.value = event.session_id
      break
    case 'delta':
      assistant.content += event.content || ''
      break
    case 'tool':
      assistant.tools.forEach((t) => {
        if (t.status === 'running') t.status = 'done'
      })
      assistant.tools.push({
        id: createId('tool'),
        message: event.message || event.message_i18n || '工具调用',
        status: 'running',
      })
      break
    case 'attachment':
      if (event.attachment?.url || event.attachment?.download_url) {
        assistant.attachments.push({
          kind: (event.attachment.kind as AgentMessageAttachment['kind']) || 'file',
          url: event.attachment.url || event.attachment.download_url || '',
          download_url: event.attachment.download_url || event.attachment.url,
          name: event.attachment.name,
          mime_type: event.attachment.mime_type,
          size: event.attachment.size,
        })
      }
      break
    case 'choice': {
      const card = normalizeChoiceCard({
        ...event.choice,
        prompt: event.choice?.prompt || event.choice?.text || event.choice?.message || '',
        status: 'pending',
      })
      if (card) assistant.choices.push(card)
      break
    }
    case 'message_update':
      applyMessageUpdate(event)
      break
    case 'done':
      if (assistant.status !== 'error') assistant.status = 'done'
      assistant.tools.forEach((t) => {
        t.status = 'done'
      })
      schedulePersistState(200)
      break
    case 'error':
      assistant.status = 'error'
      assistant.content ||= event.message_i18n || event.message || '出错了'
      assistant.tools.forEach((t) => {
        t.status = 'done'
      })
      schedulePersistState(200)
      break
    default:
      break
  }
  if (event.type === 'delta' || event.type === 'choice' || event.type === 'attachment' || event.type === 'tool') {
    schedulePersistState(1000)
  }
  void nextTick(scrollToBottom)
}

async function handleChoiceClick(
  message: AgentChatMessage,
  choice: AgentChoiceCard,
  button: AgentChoiceButton,
): Promise<void> {
  if (sending.value || recording.value || choice.status !== 'pending') return
  sending.value = true
  errorTip.value = ''
  let assistant: AgentChatMessage | null = null
  try {
    const result = await postAgentChoiceCallback({
      session_id: sessionId.value,
      callback_data: button.callback_data,
      original_message_id: message.id,
      original_chat_id: sessionId.value,
    })
    const agentMessage = String(result.message || '')
    const choiceSelection = buildChoiceSelection(choice, button)
    choiceSelection.selected_description =
      String(result.display_message || '') || getChoiceButtonSelectionText(button)
    if (result.feedback && typeof result.feedback === 'object') {
      const fb = result.feedback as Record<string, unknown>
      choiceSelection.selected_label = String(fb.selected_label || choiceSelection.selected_label || button.label)
      choiceSelection.selected_value = String(fb.selected_value || choiceSelection.selected_value || button.callback_data)
    }
    markChoiceSelected(choice, button, choiceSelection)
    await persistState()

    // 无后续流时仅更新选择状态
    if (!agentMessage && !result.traditional) {
      return
    }

    abortController = new AbortController()
    assistant = addMessage('assistant', '', 'streaming')
    await streamAgentChat(
      {
        text: agentMessage || choiceSelection.selected_value || button.callback_data,
        display_text: choiceSelection.selected_label || choiceSelection.selected_description,
        session_id: sessionId.value,
        echo_user: false,
      },
      {
        signal: abortController.signal,
        onEvent: (ev) => applyStreamEvent(ev, assistant!),
      },
    )
    if (assistant.status === 'streaming') {
      assistant.status = 'done'
      assistant.tools.forEach((t) => {
        t.status = 'done'
      })
    }
    if (isEmptyAssistantMessage(assistant)) {
      messages.value = messages.value.filter((m) => m.id !== assistant!.id)
    }
    await persistState()
  } catch (e) {
    choice.status = 'expired'
    const msg = String((e as Error)?.message || e || '该选择已失效，请重新发起选择')
    errorTip.value = msg
    if (assistant) {
      assistant.status = 'error'
      assistant.content = msg
    }
    await persistState()
  } finally {
    abortController = null
    sending.value = false
    void nextTick(scrollToBottom)
  }
}

function stopStream(): void {
  try {
    abortController?.abort()
  } catch {
    /* 中止控制器可能已结束，继续清理本地流状态。 */
  }
  abortController = null
  if (sessionId.value) void stopAgentSession(sessionId.value)
  sending.value = false
  const last = messages.value[messages.value.length - 1]
  if (last?.status === 'streaming') {
    last.status = 'done'
    last.tools.forEach((t) => {
      t.status = 'done'
    })
  }
}

async function openFilePicker(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'agent:attachments',
    view: 'agent',
    accept: '*/*',
    multiple: true,
    title: '选择要添加的图片或文件',
  })
  addPickedAttachments(files)
}

function addPickedAttachments(picked: PickedPageFile[]): void {
  const next = picked.map((item) => {
    const file = new File([item.bytes], item.name, { type: item.type })
    const kind = getFileKind(file)
    return {
      id: createId('attachment'),
      file,
      kind,
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      preview_url: kind === 'image' ? URL.createObjectURL(file) : undefined,
    } satisfies AgentPendingAttachment
  })
  pendingAttachments.value.push(...next)
}

function removePendingAttachment(id: string): void {
  const item = pendingAttachments.value.find((x) => x.id === id)
  if (item?.preview_url) URL.revokeObjectURL(item.preview_url)
  pendingAttachments.value = pendingAttachments.value.filter((x) => x.id !== id)
}

async function loadSlashCommands(): Promise<void> {
  if (slashCommandsLoaded.value || slashCommandsLoading.value) return
  slashCommandsLoading.value = true
  try {
    slashCommands.value = await listAgentCommands()
    slashCommandsLoaded.value = true
  } catch (e) {
    errorTip.value = String((e as Error)?.message || e || '命令列表加载失败')
  } finally {
    slashCommandsLoading.value = false
  }
}

function selectSlashCommand(command: AgentSlashCommand): void {
  showQuickCommands.value = false
  input.value = `${command.command} `
  void nextTick(() => {
    syncInputHeight()
    inputRef.value?.focus()
  })
}

function selectQuickCommand(command: { command: string; description: string }): void {
  showQuickCommands.value = false
  input.value = `${command.command} `
  void nextTick(() => {
    syncInputHeight()
    inputRef.value?.focus()
  })
}

function toggleQuickCommands(): void {
  if (sending.value || recording.value) return
  showQuickCommands.value = !showQuickCommands.value
  if (showQuickCommands.value) {
    // 打开快捷面板时收起输入联想，避免两层菜单叠加
    void loadSlashCommands()
  }
}

function handleInputChange(): void {
  syncInputHeight()
  if (showQuickCommands.value && input.value.trim()) {
    // 开始键入后关闭快捷面板，改走 / 联想
    showQuickCommands.value = false
  }
  if (input.value.trimStart().startsWith('/')) void loadSlashCommands()
}

function getRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function getRecordingFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function stopRecordingStream(): void {
  mediaRecorderStream?.getTracks().forEach((track) => track.stop())
  mediaRecorderStream = null
}

function clearRecordingTimer(): void {
  if (recordingTimer === null) return
  window.clearInterval(recordingTimer)
  recordingTimer = null
}

function finishRecordingState(): void {
  recording.value = false
  recordingStartedAt.value = 0
  recordingDuration.value = 0
  mediaRecorder = null
  clearRecordingTimer()
  stopRecordingStream()
}

async function startVoiceRecording(): Promise<void> {
  if (!canRecord.value) return
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    errorTip.value = '当前浏览器不支持录音'
    return
  }
  try {
    errorTip.value = ''
    recordingChunks = []
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = getRecorderMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    mediaRecorderStream = stream
    mediaRecorder = recorder
    recording.value = true
    recordingStartedAt.value = Date.now()
    recordingDuration.value = 0
    recordingTimer = window.setInterval(() => {
      recordingDuration.value = Math.floor((Date.now() - recordingStartedAt.value) / 1000)
    }, 500)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data)
    }
    recorder.onstop = () => {
      const recordedMimeType = recorder.mimeType || mimeType || 'audio/webm'
      const audioBlob = new Blob(recordingChunks, { type: recordedMimeType })
      const extension = getRecordingFileExtension(recordedMimeType)
      const file = new File([audioBlob], `voice-${Date.now()}.${extension}`, { type: recordedMimeType })
      finishRecordingState()
      recordingChunks = []
      if (audioBlob.size <= 0) {
        errorTip.value = '录音失败，请重试'
        return
      }
      pendingAttachments.value.push({
        id: createId('recording'),
        file,
        kind: 'audio',
        name: file.name,
        mime_type: recordedMimeType,
        size: file.size,
      })
      void send()
    }
    recorder.onerror = () => {
      finishRecordingState()
      recordingChunks = []
      errorTip.value = '录音失败，请重试'
    }
    recorder.start()
  } catch (e) {
    finishRecordingState()
    recordingChunks = []
    errorTip.value = String((e as Error)?.message || e || '无法访问麦克风，请检查浏览器权限')
  }
}

function stopVoiceRecording(): void {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    finishRecordingState()
    return
  }
  mediaRecorder.stop()
}

function cancelVoiceRecording(): void {
  if (mediaRecorder) {
    mediaRecorder.ondataavailable = null
    mediaRecorder.onstop = null
    mediaRecorder.onerror = null
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  }
  mediaRecorder = null
  recordingChunks = []
  finishRecordingState()
}

function toggleVoiceRecording(): void {
  if (recording.value) {
    stopVoiceRecording()
    return
  }
  void startVoiceRecording()
}

async function send(): Promise<void> {
  const text = input.value.trim()
  const attachments = [...pendingAttachments.value]
  if ((!text && !attachments.length) || sending.value || recording.value) return

  errorTip.value = ''
  showQuickCommands.value = false
  input.value = ''
  clearPendingAttachments()
  void nextTick(syncInputHeight)
  ensureSessionId()

  sending.value = true
  abortController = new AbortController()
  let assistant: AgentChatMessage | null = null
  try {
    const prepared = await prepareAgentAttachments(attachments, sessionId.value)
    const userLabel =
      text ||
      (prepared.userAttachments[0]?.name ? `[附件] ${prepared.userAttachments[0].name}` : '')
    addMessage('user', userLabel, 'done', prepared.userAttachments)
    assistant = addMessage('assistant', '', 'streaming')
    await streamAgentChat(
      {
        text,
        display_text: text,
        session_id: sessionId.value,
        images: prepared.images,
        files: prepared.files,
        audio_refs: prepared.audioRefs,
        echo_user: true,
      },
      {
        signal: abortController.signal,
        onEvent: (ev) => applyStreamEvent(ev, assistant!),
      },
    )
    if (assistant.status === 'streaming') {
      assistant.status = 'done'
      assistant.tools.forEach((t) => {
        t.status = 'done'
      })
    }
    // 仅无文本/附件/选择卡/工具时清理占位消息；/skills 等命令主要靠 choice 输出
    if (isEmptyAssistantMessage(assistant) && assistant.status !== 'error') {
      messages.value = messages.value.filter((m) => m.id !== assistant!.id)
    }
    try {
      sessions.value = await listAgentSessions(1, 40)
    } catch {
      /* 远端历史刷新失败时保留当前会话与本地历史。 */
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      if (assistant) assistant.status = 'done'
    } else {
      const msg = String((e as Error)?.message || e || '请求失败')
      if (assistant) {
        assistant.status = 'error'
        assistant.content = msg
      } else {
        addMessage('assistant', msg, 'error')
      }
      errorTip.value = msg
    }
  } finally {
    abortController = null
    sending.value = false
    clearStreamPersistTimer()
    void persistState()
    void nextTick(scrollToBottom)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

onMounted(() => {
  void (async () => {
    await restoreLocalAgentState()
    addPickedAttachments(await consumePickedPageFiles('agent:attachments'))
    await checkCapability()
    // 后台合并服务端历史，不阻塞当前会话展示
    try {
      const remote = await listAgentSessions(1, 40)
      localHistorySessions.value = await saveAgentLocalHistory(
        mergeAgentHistorySessions(remote, localHistorySessions.value),
      )
    } catch {
      /* 服务端历史合并失败时继续使用已恢复的本地历史。 */
    }
    await nextTick(syncInputHeight)
    if (messages.value.length) {
      // 恢复消息后静默贴底，避免顶→底闪烁
      if (listSettled.value) listSettled.value = false
      await settleListAtBottom()
    } else {
      listSettled.value = true
    }
  })()
})

onUnmounted(() => {
  clearStreamPersistTimer()
  void persistState()
  stopStream()
  cancelVoiceRecording()
  clearPendingAttachments()
})
</script>

<style scoped>
.agent-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: transparent;
}

.agent-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 8px 8px 10px;
  gap: 8px;
  box-sizing: border-box;
}

.agent-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  min-height: 0;
}

/* 检查可用性：轻量居中，避免白底卡片抢背景 */
.agent-state-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  max-width: 260px;
  padding: 8px;
}

.agent-state-loading__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.agent-state-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2.5px solid rgba(124, 58, 237, 0.18);
  border-top-color: #7c3aed;
  animation: agent-spin 0.75s linear infinite;
  box-sizing: border-box;
}

@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}

.agent-state-loading__title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.35;
  text-shadow: none;
}

.agent-state-loading__desc {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
  text-shadow: none;
}

.agent-state-card {
  width: 100%;
  max-width: 320px;
  padding: 16px;
  border-radius: 12px;
  background: var(--mp-color-surface, #fff);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.agent-state-card--warn {
  color: #92400e;
  background: #fffbeb;
  border-color: #fde68a;
}

.agent-state-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #78350f;
}

.agent-state-desc {
  font-size: 12px;
  line-height: 1.5;
}

:global(html[data-theme='dark']) .agent-state-loading__title {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .agent-state-loading__desc {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-state-spinner {
  border-color: rgba(196, 181, 253, 0.22) !important;
  border-top-color: #c4b5fd !important;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}

.agent-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agent-title__mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(124, 58, 237, 0.12);
  --agent-mini-outline: #5b00c5;
  --agent-mini-outline-soft: #7432df;
  --agent-mini-shell-start: #d3bbff;
  --agent-mini-shell-mid: #a576ff;
  --agent-mini-shell-end: #8d51f9;
  --agent-mini-face-start: #24124e;
  --agent-mini-face-end: #100525;
  --agent-mini-eye: #f1dcff;
}

.agent-mini-bot,
.agent-mini-bot span {
  box-sizing: border-box;
}

.agent-mini-bot {
  position: relative;
  display: block;
  width: 1.85rem;
  height: 1.85rem;
}

.agent-mini-bot__antenna {
  position: absolute;
  display: block;
  border-radius: 999px;
  background: var(--agent-mini-outline);
  width: 0.12rem;
  height: 0.42rem;
  top: 0;
  left: 1.18rem;
  transform: rotate(20deg);
  transform-origin: bottom center;
}

.agent-mini-bot__antenna::after {
  content: '';
  position: absolute;
  border: 1.5px solid var(--agent-mini-outline);
  border-radius: 999px;
  background: var(--agent-mini-shell-start);
  width: 0.28rem;
  height: 0.28rem;
  top: -0.24rem;
  left: -0.09rem;
}

.agent-mini-bot__head {
  position: absolute;
  display: block;
  border: 1.5px solid var(--agent-mini-outline);
  border-radius: 8px;
  background: linear-gradient(145deg, var(--agent-mini-shell-start) 0%, var(--agent-mini-shell-end) 100%);
  width: 1.45rem;
  height: 1.04rem;
  top: 0.42rem;
  left: 0.2rem;
  box-shadow:
    inset 0 -0.12rem 0 rgba(54, 0, 126, 0.22),
    inset 0.08rem 0.08rem 0 rgba(255, 255, 255, 0.22);
}

.agent-mini-bot__face {
  position: absolute;
  display: block;
  border: 1.5px solid var(--agent-mini-outline-soft);
  border-radius: 6px;
  background: linear-gradient(180deg, var(--agent-mini-face-start) 0%, var(--agent-mini-face-end) 100%);
  width: 1rem;
  height: 0.62rem;
  top: 0.18rem;
  left: 0.16rem;
}

.agent-mini-bot__eye {
  position: absolute;
  display: block;
  border-radius: 0 0 999px 999px;
  width: 0.22rem;
  height: 0.24rem;
  top: 0.16rem;
  border-bottom: 0.1rem solid var(--agent-mini-eye);
  animation: agent-blink 4.8s ease-in-out infinite;
}

.agent-mini-bot__eye--left {
  left: 0.22rem;
}

.agent-mini-bot__eye--right {
  right: 0.22rem;
}

.agent-mini-bot__body {
  position: absolute;
  display: block;
  border: 1.5px solid var(--agent-mini-outline);
  border-radius: 0.4rem;
  background: linear-gradient(145deg, var(--agent-mini-shell-mid) 0%, var(--agent-mini-shell-end) 82%);
  width: 0.98rem;
  height: 0.54rem;
  top: 1.3rem;
  left: 0.44rem;
}

@keyframes agent-blink {
  0%,
  46%,
  50%,
  100% {
    transform: scaleY(1);
  }
  48% {
    transform: scaleY(0.15);
  }
}

.agent-title__text {
  min-width: 0;
}

.agent-title__status {
  font-size: 13px;
  font-weight: 500;
  color: rgba(15, 23, 42, 0.72);
  line-height: 1.2;
}

.agent-title__status.is-busy {
  color: #7c3aed;
}

.agent-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.agent-icon-btn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.agent-icon-btn:hover:not(:disabled) {
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
}

.agent-icon-btn.is-active {
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}

.agent-icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.agent-history {
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  max-height: 160px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
  overflow: hidden;
}

.agent-history__header {
  padding: 8px 12px 4px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.agent-history__empty {
  padding: 10px 12px 12px;
  font-size: 12px;
  color: #94a3b8;
}

.agent-history__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
  padding: 2px 6px 8px;
}

.agent-history-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border-radius: 10px;
  background: transparent;
  box-sizing: border-box;
  transition: background 0.15s ease;
}

.agent-history-item:hover,
.agent-history-item.is-active {
  background: rgba(124, 58, 237, 0.08);
}

.agent-history-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px 6px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.agent-history-item__main:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.agent-history-item__delete {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.75;
}

.agent-history-item:hover .agent-history-item__delete,
.agent-history-item.is-active .agent-history-item__delete {
  opacity: 1;
}

.agent-history-item__delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.agent-history-item__delete:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.agent-history-item__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-history-item__title {
  font-size: 12px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.agent-history-item__channel,
.agent-history-item__time {
  font-size: 11px;
  color: #94a3b8;
}

.agent-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 4px 2px 2px;
  border-radius: 12px;
}

/* 会话恢复期间隐藏，滚到底后再显示，避免顶→底视觉闪烁 */
.agent-messages.is-settling {
  opacity: 0;
  pointer-events: none;
}

.agent-messages__content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
}

.agent-empty {
  margin: auto;
  text-align: center;
  padding: 20px 14px 28px;
  color: #64748b;
  max-width: 280px;
}

.agent-empty__mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7c3aed;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(124, 58, 237, 0.14);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
}

.agent-empty__title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 6px;
  text-shadow: none;
}

.agent-empty__subtitle {
  font-size: 12px;
  line-height: 1.55;
  color: #475569;
  text-shadow: none;
}

.agent-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.agent-message--user {
  align-items: flex-end;
}

.agent-message--assistant,
.agent-message--system {
  align-items: stretch; /* 助手气泡拉满可用宽，占满可用宽度 */
}

.agent-message__meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #94a3b8;
  padding: 0 2px;
}

.agent-message--assistant .agent-message__meta,
.agent-message--system .agent-message__meta {
  align-self: flex-start;
}

.agent-message__bubble {
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 我：随内容变宽，靠右显示且不超出容器 */
.agent-message--user .agent-message__bubble {
  width: fit-content;
  max-width: 100%;
  background: rgba(124, 58, 237, 0.12);
  border-color: rgba(124, 58, 237, 0.16);
}

/* 助手：占满行宽，占满可用行宽 */
.agent-message--assistant .agent-message__bubble,
.agent-message--system .agent-message__bubble {
  width: 100%;
  max-width: 100%;
}

.agent-message__bubble.is-error {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

/* 选择卡 + 底部按钮行 */
.agent-choices {
  display: grid;
  gap: 6px;
  width: 100%;
  max-width: 100%;
  margin-top: 2px;
  box-sizing: border-box;
}

.agent-choice {
  display: grid;
  gap: 6px;
}

.agent-choice__bubble {
  display: grid;
  gap: 10px;
  padding: 12px 13px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.agent-choice__title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  color: rgba(15, 23, 42, 0.82);
}

.agent-choice__prompt {
  font-size: 13px;
  line-height: 1.45;
  color: rgba(15, 23, 42, 0.9);
  overflow-wrap: anywhere;
}

.agent-choice__selected {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(25, 178, 160, 0.28);
  background: rgba(25, 178, 160, 0.1);
  color: rgba(15, 23, 42, 0.78);
  font-size: 12px;
  white-space: normal;
}

.agent-choice__selected span {
  line-height: 1.4;
  min-width: 0;
  overflow-wrap: anywhere;
}

.agent-choice__selected.is-expired {
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.1);
  color: #92400e;
}

.agent-choice__buttons {
  display: grid;
  gap: 4px;
}

.agent-choice__button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* 扩展侧更紧凑，保持紧凑视觉体量 */
.agent-choice__button {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  min-height: 28px;
  height: auto;
  padding: 3px 8px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  color: #7c3aed;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: none;
}

.agent-choice__button-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-choice__button:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.08);
  border-color: rgba(124, 58, 237, 0.18);
}

.agent-choice__button:disabled {
  color: rgba(15, 23, 42, 0.46);
  cursor: not-allowed;
  opacity: 1;
}

/* Markdown 内容 */
.markdown-body {
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-weight: 600;
  line-height: 1.3;
  margin: 0.5rem 0;
  color: inherit;
}

.markdown-body :deep(h1) {
  font-size: 1.35rem;
}

.markdown-body :deep(h2) {
  font-size: 1.18rem;
}

.markdown-body :deep(h3) {
  font-size: 1.05rem;
}

.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 0.98rem;
}

.markdown-body :deep(p) {
  margin: 0 0 0.5rem;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(a) {
  color: #7c3aed;
  text-decoration: underline;
  word-break: break-all;
}

.markdown-body :deep(a:hover) {
  opacity: 0.85;
}

.markdown-body :deep(strong) {
  font-weight: 700;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(del) {
  text-decoration: line-through;
  opacity: 0.8;
}

.markdown-body :deep(code) {
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.1rem 0.3rem;
}

.markdown-body :deep(pre) {
  overflow: auto;
  padding: 0.75rem;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.08);
  margin: 0.5rem 0;
  max-width: 100%;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.88em;
  white-space: pre;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 0.5rem;
  padding-left: 1.5rem;
}

.markdown-body :deep(ul) {
  list-style-type: disc;
}

.markdown-body :deep(ol) {
  list-style-type: decimal;
}

.markdown-body :deep(li) {
  display: list-item;
  margin: 0.25rem 0;
}

.markdown-body :deep(li > p) {
  margin: 0;
}

.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 0.15rem 0 0.15rem;
}

.markdown-body :deep(blockquote) {
  margin: 0.5rem 0;
  padding-left: 1rem;
  border-left: 4px solid rgba(15, 23, 42, 0.16);
  color: rgba(15, 23, 42, 0.74);
  font-style: italic;
}

/* MP：table 用 block + 横向滚动承载宽表 */
.markdown-body :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 0.5rem 0;
  border-collapse: collapse;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid rgba(15, 23, 42, 0.14);
  padding: 0.4rem 0.65rem;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.markdown-body :deep(th) {
  background: rgba(15, 23, 42, 0.07);
  font-weight: 600;
  color: #1e293b;
}

.markdown-body :deep(td) {
  color: #334155;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(15, 23, 42, 0.18);
  margin: 1rem 0;
}

.markdown-body :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 0.35rem 0;
}

.markdown-body :deep(input[type='checkbox']) {
  margin-right: 0.35rem;
  vertical-align: middle;
}

.agent-message__bubble.markdown-body,
.agent-choice__prompt.markdown-body {
  overflow-x: auto;
}

.agent-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.agent-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #64748b;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.04);
}

.agent-tool__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.agent-tool__dot.is-running {
  background: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
  animation: agent-pulse 1s ease-in-out infinite;
}

.agent-tool__dot.is-done {
  background: #22c55e;
}

@keyframes agent-pulse {
  50% {
    opacity: 0.45;
  }
}

.agent-attachments {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.agent-attachment {
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
}

.agent-attachment__image {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}

.agent-attachment__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 0;
  font-size: 12px;
  color: #475569;
}

.agent-attachment__audio {
  display: block;
  width: calc(100% - 16px);
  margin: 8px;
}

.agent-attachment__file {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  color: #334155;
}

.agent-attachment__file-text {
  min-width: 0;
  display: grid;
}

.agent-attachment__file-text span,
.agent-attachment__file-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-attachment__file-text small {
  color: #94a3b8;
  font-size: 11px;
}

.agent-attachment__download {
  color: #7c3aed;
  display: inline-flex;
}

.agent-typing {
  display: inline-flex;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.agent-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a78bfa;
  animation: agent-typing 1.1s ease-in-out infinite;
}

.agent-typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.agent-typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes agent-typing {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.agent-composer {
  padding: 0 2px 2px;
  background: transparent;
  border: 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-alert {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.agent-pending {
  display: grid;
  gap: 6px;
  max-height: 8rem;
  overflow: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.88);
}

.agent-pending-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-pending-item__preview {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
}

.agent-pending-item__text {
  min-width: 0;
  display: grid;
}

.agent-pending-item__text span,
.agent-pending-item__text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-pending-item__text small {
  color: #94a3b8;
  font-size: 11px;
}

.agent-pending-item__remove {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.agent-pending-item__remove:hover:not(:disabled) {
  background: rgba(15, 23, 42, 0.06);
}

/* 外层只负责圆角裁剪；滚动放到内层，避免滚动条溢出圆角 */
.agent-command-menu {
  position: relative;
  max-height: 15rem;
  overflow: hidden;
  padding: 0;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.1);
  box-sizing: border-box;
}

.agent-command-menu--quick {
  max-height: min(52vh, 22rem);
}

.agent-command-menu__scroll {
  display: grid;
  gap: 4px;
  max-height: inherit;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 4px 8px 8px;
  box-sizing: border-box;
}

.agent-command-menu--quick .agent-command-menu__scroll {
  gap: 8px;
  padding: 10px 4px 10px 10px;
}

/* 滚动条：4px / tokens / radius 6 */
.agent-command-menu__scroll::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.agent-command-menu__scroll::-webkit-scrollbar-track {
  background: var(--mp-scrollbar-track, transparent);
}

.agent-command-menu__scroll::-webkit-scrollbar-thumb {
  background: var(--mp-scrollbar-thumb, rgba(0, 0, 0, 0.2));
  border-radius: 6px;
}

.agent-command-menu__tip {
  padding: 2px 8px 4px 2px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
}

.agent-command-group {
  display: grid;
  gap: 2px;
}

.agent-command-group__title {
  padding: 4px 8px 2px 2px;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.02em;
}

.agent-command {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 6px 10px 6px 8px;
  margin-right: 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.agent-command:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.1);
}

.agent-command:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.agent-command.is-loading {
  color: #94a3b8;
  cursor: default;
  grid-template-columns: 1fr;
}

.agent-command__name {
  overflow: hidden;
  color: #7c3aed;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-command__desc {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-input {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 46px;
  padding: 3px 2px 3px 2px;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
  box-sizing: border-box;
}

/* 右侧图标成组：无左边框/分割线，按钮间距收紧 */
.agent-input-actions {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  margin: 0;
  padding: 0 1px 0 0;
  border: 0 !important;
  border-left: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none;
}

.agent-input-actions::before,
.agent-input-actions::after,
.agent-mic-btn::before,
.agent-mic-btn::after {
  content: none !important;
  display: none !important;
  border: 0 !important;
  width: 0 !important;
  background: transparent !important;
}

.agent-quick-btn.is-active {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.12);
}



.agent-surface-btn {
  width: 30px;
  height: 30px;
  border: 0 !important;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  color: #64748b;
  background: transparent;
  align-self: center;
  padding: 0;
  margin: 0;
  box-shadow: none !important;
  outline: none;
}

.agent-input-actions .agent-surface-btn {
  width: 28px;
  height: 28px;
  margin: 0;
}

.agent-surface-btn:hover:not(:disabled) {
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
}

.agent-surface-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.agent-attach-btn {
  margin-left: 1px;
  margin-right: 0;
}

/* 去掉麦克风左侧分割线/描边感 */
.agent-mic-btn {
  border: 0 !important;
  border-left: 0 !important;
  border-right: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

.agent-mic-btn.is-recording {
  color: #ef4444;
}

.agent-textarea {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  align-self: center;
  border: 0 !important;
  border-right: 0 !important;
  outline: none !important;
  resize: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5rem;
  color: #0f172a;
  min-height: 1.5rem;
  max-height: 7.5rem;
  height: 1.5rem;
  padding: 0 6px 0 4px;
  margin: 0;
  /* 单行时不出现右侧滚动条（易被看成分割线） */
  overflow-x: hidden;
  overflow-y: hidden;
  box-sizing: border-box;
  box-shadow: none !important;
}

.agent-textarea.is-expanded {
  overflow-y: auto;
}

.agent-textarea::placeholder {
  color: #94a3b8;
  opacity: 1;
}

.agent-textarea::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.agent-send-btn:hover:not(:disabled) {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
}

.agent-send-btn:disabled {
  opacity: 0.35;
}

.agent-send-btn.is-stop {
  color: #ef4444;
}

.agent-send-btn.is-stop:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

/* 暗色主题：!important 覆盖浅色硬编码（与 shell-dark 双保险） */
:global(html[data-theme='dark']) .agent-header {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28) !important;
}

:global(html[data-theme='dark']) .agent-title__status {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-title__status.is-busy {
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-empty__title,
:global(html[data-theme='dark']) .agent-history-item__title {
  color: #e2e8f0 !important;
  text-shadow: none !important;
}

:global(html[data-theme='dark']) .agent-history-item__delete {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-history-item__delete:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.14) !important;
  color: #f87171 !important;
}

:global(html[data-theme='dark']) .agent-choice__selected {
  border-color: rgba(45, 212, 191, 0.3) !important;
  background: rgba(20, 184, 166, 0.14) !important;
  color: #99f6e4 !important;
}

:global(html[data-theme='dark']) .agent-choice__selected.is-expired {
  border-color: rgba(251, 191, 36, 0.3) !important;
  background: rgba(245, 158, 11, 0.14) !important;
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .agent-choice__button {
  background: rgba(15, 23, 42, 0.72) !important;
  border-color: rgba(167, 139, 250, 0.35) !important;
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-choice__button:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.18) !important;
  border-color: rgba(167, 139, 250, 0.5) !important;
}

:global(html[data-theme='dark']) .agent-choice__button:disabled {
  color: rgba(148, 163, 184, 0.46) !important;
}

:global(html[data-theme='dark']) .agent-empty__subtitle,
:global(html[data-theme='dark']) .agent-message__meta {
  color: #94a3b8 !important;
  text-shadow: none !important;
}

:global(html[data-theme='dark']) .agent-history,
:global(html[data-theme='dark']) .agent-pending,
:global(html[data-theme='dark']) .agent-command-menu,
:global(html[data-theme='dark']) .agent-attachment {
  background: #1e293b !important;
  border-color: #334155 !important;
}

:global(html[data-theme='dark']) .agent-empty__mark {
  background: rgba(30, 41, 59, 0.9) !important;
  border-color: rgba(124, 58, 237, 0.3) !important;
  box-shadow: none !important;
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-message__bubble,
:global(html[data-theme='dark']) .agent-typing,
:global(html[data-theme='dark']) .agent-choice__bubble {
  background: #1e293b !important;
  border-color: #334155 !important;
  color: #e2e8f0 !important;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22) !important;
}

:global(html[data-theme='dark']) .agent-choice__title {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .agent-choice__prompt {
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(code),
:global(html[data-theme='dark']) .markdown-body :deep(pre) {
  background: rgba(148, 163, 184, 0.12) !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(a) {
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(blockquote) {
  border-left-color: rgba(148, 163, 184, 0.28) !important;
  color: rgba(226, 232, 240, 0.74) !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(th),
:global(html[data-theme='dark']) .markdown-body :deep(td) {
  border-color: rgba(148, 163, 184, 0.22) !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(th) {
  background: rgba(148, 163, 184, 0.12) !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(td) {
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .markdown-body :deep(hr) {
  border-top-color: rgba(148, 163, 184, 0.24) !important;
}

:global(html[data-theme='dark']) .agent-message--user .agent-message__bubble {
  background: rgba(124, 58, 237, 0.22) !important;
  border-color: rgba(124, 58, 237, 0.32) !important;
  color: #ede9fe !important;
}

:global(html[data-theme='dark']) .agent-message__bubble.is-error {
  background: rgba(239, 68, 68, 0.12) !important;
  border-color: rgba(248, 113, 113, 0.35) !important;
  color: #fca5a5 !important;
}

:global(html[data-theme='dark']) .agent-input {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28) !important;
}

:global(html[data-theme='dark']) .agent-textarea {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .agent-textarea::placeholder {
  color: #64748b !important;
}

:global(html[data-theme='dark']) .agent-surface-btn,
:global(html[data-theme='dark']) .agent-icon-btn,
:global(html[data-theme='dark']) .agent-pending-item__remove {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-surface-btn:hover:not(:disabled),
:global(html[data-theme='dark']) .agent-icon-btn:hover:not(:disabled),
:global(html[data-theme='dark']) .agent-pending-item__remove:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.12) !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .agent-icon-btn.is-active {
  background: rgba(124, 58, 237, 0.2) !important;
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-send-btn:hover:not(:disabled),
:global(html[data-theme='dark']) .agent-quick-btn.is-active {
  color: #c4b5fd !important;
  background: rgba(124, 58, 237, 0.18) !important;
}

:global(html[data-theme='dark']) .agent-command-group__title,
:global(html[data-theme='dark']) .agent-command-menu__tip {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-command__name {
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-command__desc {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-command:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.16) !important;
}

:global(html[data-theme='dark']) .agent-send-btn.is-stop,
:global(html[data-theme='dark']) .agent-mic-btn.is-recording {
  color: #f87171 !important;
}

:global(html[data-theme='dark']) .agent-send-btn.is-stop:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14) !important;
  color: #fca5a5 !important;
}

:global(html[data-theme='dark']) .agent-state-card {
  background: #1e293b !important;
  border-color: #334155 !important;
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-state-card--warn {
  background: rgba(120, 53, 15, 0.28) !important;
  border-color: rgba(251, 191, 36, 0.32) !important;
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .agent-state-title {
  color: #fcd34d !important;
}

:global(html[data-theme='dark']) .agent-history__header,
:global(html[data-theme='dark']) .agent-attachment__file {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .agent-attachment__meta {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-attachment__download {
  color: #c4b5fd !important;
}

:global(html[data-theme='dark']) .agent-tool {
  background: rgba(148, 163, 184, 0.1) !important;
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .agent-alert {
  color: #fca5a5 !important;
  background: rgba(239, 68, 68, 0.12) !important;
  border-color: rgba(248, 113, 113, 0.35) !important;
}

:global(html[data-theme='dark']) .agent-history-item:hover,
:global(html[data-theme='dark']) .agent-history-item.is-active {
  background: rgba(124, 58, 237, 0.16) !important;
}
</style>
