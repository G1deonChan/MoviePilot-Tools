import { defineBackground } from 'wxt/sandbox'
import { handleRuntimeMessages, onMessage, forwardToOffscreen, MSG } from '../core/bus'
import { ensureOffscreenDocument } from '../core/offscreen'
import { ALARM, initAlarms, registerAlarmHandler } from '../core/alarms'
import { STORAGE_KEYS, storageSet } from '../core/storage'
import { getBackupJobState, acknowledgeBackupJob, markInterruptedBackupJob, runBackupJob, startBackupJob } from '../services/backup-job'
import { runDailyCookieUaIfNeeded, syncCookieUa } from '../services/cookie-sync'
import {
  closeAutoOpenedTabs,
  openAllSites,
  runMonthlySiteAutoOpenIfNeeded,
} from '../services/site-auto-open'
import {
  addOrUpdateCredentialFromLogin,
  getCredentialByHost,
  normalizeCredentialHost,
  loadBlacklist,
  saveBlacklist,
} from '../services/credential'
import {
  recognizeCaptchaInBackground,
  recognizeOfflineInBackground,
} from '../services/captcha'
import type { SiteBlacklistEntry } from '../core/types'
import { savePickedPageFiles, type PickedPageFile } from '../core/page-file-picker'
import { decodePageFileChunks } from '../core/page-file-chunks'
import { fetchSupportingDomains } from '../services/site-domain-alias'
import {
  PAGE_FILE_PICK_REQUEST,
  PAGE_FILE_PICKER_CANCEL,
  PAGE_FILE_PICKER_OPEN,
  PAGE_FILE_PICK_PORT_PREFIX,
  type PageFilePickerOptions,
  type PageFilePickerPortMessage,
} from '../core/page-file-picker-contracts'
import { resetLegacyNamespace } from '../core/store-repository'
import { getOrCreateDeviceStore } from '../core/device-root'
import '../services/auth'








// Service Worker 入口：消息路由 + 定时任务
export default defineBackground(() => {
  void getOrCreateDeviceStore().then(() => resetLegacyNamespace())
  void markInterruptedBackupJob()

  initPageFilePickerBridge()

  // 仅离线 OCR：background 读导入模型 → offscreen 推理
  onMessage(MSG.OCR_RECOGNIZE, async (payload) => {
    const image = String((payload as { image?: string } | null)?.image || '')
    if (!image) throw new Error('缺少图片数据')
    return recognizeOfflineInBackground(image)
  })
  // 完整验证码识别（离线/服务端/AI）必须在 background，避免页面 Mixed Content
  onMessage(MSG.CAPTCHA_RECOGNIZE, async (payload) => {
    const data = payload as { image?: string; expectedLength?: number } | null
    const image = String(data?.image || '')
    if (!image) throw new Error('缺少验证码图片数据')
    return recognizeCaptchaInBackground(image, { expectedLength: data?.expectedLength })
  })
  // 站点适配数据由后台读取，避免 HTTPS PT 页面直连 HTTP MoviePilot 触发混合内容。
  onMessage(MSG.SITE_SUPPORTING_GET, () => fetchSupportingDomains())
  // 切换/删除模型后清空 offscreen 会话缓存
  onMessage(MSG.OCR_RESET_SESSION, async () => {
    try {
      await ensureOffscreenDocument()
      await forwardToOffscreen(MSG.OFFSCREEN_OCR_RESET_SESSION, null)
    } catch {
      /* Offscreen 尚未创建或上下文已失效时无需重置会话缓存。 */
    }
    return true
  })

  // content：按域名取凭据（优先设备密钥 runtime 包，无需 PIN）
  onMessage(MSG.PT_GET_CRED, async (payload) => {
    const domain = String((payload as { domain?: string })?.domain || '')
    const credential = await getCredentialByHost(domain)
    return { credential }
  })

  // content：登录后保存/更新凭据（写 runtime；已解锁时同步 Master）
  onMessage(MSG.PT_SAVE_CRED, async (payload) => {
    const p = (payload || {}) as { domain?: string; username?: string; password?: string; name?: string }
    const action = await addOrUpdateCredentialFromLogin({
      domain: String(p.domain || ''),
      username: String(p.username || ''),
      password: String(p.password || ''),
      name: p.name,
    })
    return { action }
  })

  // content：整站加入黑名单（拦截登录填充 + 保存提示）
  onMessage(MSG.PT_BLOCK_SITE, async (payload) => {
    const domain = String((payload as { domain?: string })?.domain || '')
    await upsertBlacklist(domain, {
      blockLoginFill: true,
      blockCaptchaFill: false,
      blockCredentialSavePrompt: true,
    })
    return { ok: true }
  })

  // content：仅不再提示保存
  onMessage(MSG.PT_BLOCK_SAVE_PROMPT, async (payload) => {
    const domain = String((payload as { domain?: string })?.domain || '')
    await upsertBlacklist(domain, {
      blockCredentialSavePrompt: true,
    })
    return { ok: true }
  })

  // PT 悬浮按钮：记录待跳转路由（含详情页 URL/标题）并尝试打开 popup 下载面板
  onMessage(MSG.PT_OPEN_DOWNLOAD, async (payload) => {
    const data = (payload || {}) as { url?: string; title?: string }
    const route = {
      path: 'downloads',
      query: {
        from: 'pt-float',
        url: data.url || '',
        title: data.title || '',
      },
    }
    await storageSet(STORAGE_KEYS.PENDING_ROUTE, route)
    if (data.title) {
      await storageSet(STORAGE_KEYS.PT_DOWNLOAD_TITLE, data.title)
    }
    try {
      await chrome.action.openPopup()
    } catch {
      /* 当前环境禁止脚本打开 popup 时保留待处理路由，供用户手动打开后领取。 */
    }
    return { success: true }
  })

  onMessage(MSG.BACKUP_START, async (payload) => {
    const target = (payload as { target?: unknown } | null)?.target
    if (target !== 'mp' && target !== 'webdav') throw new Error('备份目标无效')
    return startBackupJob(target, 'manual')
  })
  onMessage(MSG.BACKUP_GET_STATE, () => getBackupJobState())
  onMessage(MSG.BACKUP_ACKNOWLEDGE, (payload) => {
    const id = String((payload as { id?: unknown } | null)?.id || '')
    return acknowledgeBackupJob(id)
  })

  // 定时任务处理器（配置由各 service 的 saveConfig 重建对应闹钟）
  registerAlarmHandler(ALARM.WEBDAV_BACKUP, async () => {
    await runBackupJob('webdav', 'scheduled')
  })
  registerAlarmHandler(ALARM.MP_BACKUP, async () => {
    await runBackupJob('mp', 'scheduled')
  })
  registerAlarmHandler(ALARM.COOKIE_UA_UPDATE, async () => {
    await syncCookieUa('interval')
  })
  registerAlarmHandler(ALARM.SITE_AUTO_OPEN, async () => {
    await openAllSites('interval')
  })
  registerAlarmHandler(ALARM.SITE_AUTO_OPEN_CLOSE, async () => {
    await closeAutoOpenedTabs()
  })

  handleRuntimeMessages()
  initAlarms()

  // 扩展启动或 Service Worker 唤醒时执行到期的 Cookie/UA 更新和每月开站任务。
  void runDailyCookieUaIfNeeded().catch((e) =>
    console.error('[MoviePilot] daily cookie/ua update failed:', e),
  )
  void runMonthlySiteAutoOpenIfNeeded().catch((e) =>
    console.error('[MoviePilot] monthly site auto-open failed:', e),
  )
})

function initPageFilePickerBridge(): void {
  const tasks = new Map<
    string,
    {
      action: string
      view: string
      files: Map<number, { name: string; type: string; size: number; chunks: string[] }>
    }
  >()

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PAGE_FILE_PICK_REQUEST) return false
    const requestId = String(message.requestId || '')
    const options = message.options as Partial<PageFilePickerOptions> | undefined
    if (!requestId || !options?.action || !options.view) {
      sendResponse({ ok: false, message: '文件选择参数不完整' })
      return false
    }

    tasks.set(requestId, {
      action: options.action,
      view: options.view,
      files: new Map(),
    })
    void openPageFilePicker(requestId, message.options)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        tasks.delete(requestId)
        sendResponse({ ok: false, message: String(error) })
      })
    return true
  })

  chrome.runtime.onConnect.addListener((port) => {
    const match = new RegExp(`^${PAGE_FILE_PICK_PORT_PREFIX}(.+)$`).exec(port.name)
    if (!match) return
    const requestId = match[1]
    port.onMessage.addListener((message) => {
      void handlePageFileMessage(requestId, message, tasks)
    })
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== PAGE_FILE_PICKER_CANCEL || !message.requestId) return false
    tasks.delete(String(message.requestId))
    return false
  })
}

async function handlePageFileMessage(
  requestId: string,
  message: PageFilePickerPortMessage,
  tasks: Map<
    string,
    {
      action: string
      view: string
      files: Map<number, { name: string; type: string; size: number; chunks: string[] }>
    }
  >,
): Promise<void> {
  if (message.kind === 'task') {
    const action = String((message as { action?: string }).action || '')
    const view = String((message as { view?: string }).view || '')
    if (action && view) tasks.set(requestId, { action, view, files: new Map() })
    return
  }

  const task = tasks.get(requestId)
  if (!task) return

  if (message.kind === 'meta') {
    const index = message.index || 0
    task.files.set(index, {
      name: message.name || 'file',
      type: message.type || 'application/octet-stream',
      size: message.size || 0,
      chunks: [],
    })
    return
  }
  if (message.kind === 'chunk') {
    task.files.get(message.index || 0)?.chunks.push(message.chunk || '')
    return
  }
  if (message.kind === 'error') {
    tasks.delete(requestId)
    return
  }
  if (message.kind !== 'done') return

  const files: PickedPageFile[] = [...task.files.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, file]) => ({
      name: file.name,
      type: file.type,
      bytes: decodePageFileChunks(file.chunks, file.size),
    }))
  await savePickedPageFiles(task.action, files)
  tasks.delete(requestId)
  await storageSet(STORAGE_KEYS.FILE_PICKER_VIEW, task.view)
  try {
    await chrome.action.openPopup()
  } catch {
    // 移动端浏览器可能不允许后台自动打开扩展；用户手动打开后仍可领取任务。
  }
}

async function openPageFilePicker(requestId: string, options: unknown): Promise<void> {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true })
  const tab = tabs
    .filter((item) => item.id && /^https?:/i.test(item.url || ''))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
  if (!tab?.id) throw new Error('请先打开一个普通网页，再返回扩展选择文件')

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: PAGE_FILE_PICKER_OPEN,
      requestId,
      options,
    })
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true })
  } catch {
    throw new Error('当前网页尚未加载扩展脚本，请刷新网页后重试')
  }
}

async function upsertBlacklist(
  domainRaw: string,
  patch: Partial<Pick<SiteBlacklistEntry, 'blockLoginFill' | 'blockCaptchaFill' | 'blockCredentialSavePrompt'>>,
): Promise<void> {
  const host = normalizeCredentialHost(domainRaw)
  if (!host) throw new Error('域名无效')
  const storeDomain = /^https?:\/\//i.test(domainRaw.trim())
    ? domainRaw.trim().replace(/\/$/, '')
    : `https://${host}`
  const list = await loadBlacklist()

  const now = new Date().toISOString()
  const idx = list.findIndex((e) => {
    const a = normalizeCredentialHost(e.domain)
    return a === host || a.endsWith(`.${host}`) || host.endsWith(`.${a}`)
  })
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...patch,
      updatedAt: now,
    }
  } else {
    list.push({
      id: crypto.randomUUID(),
      domain: storeDomain,
      name: host,
      blockLoginFill: patch.blockLoginFill ?? false,
      blockCaptchaFill: patch.blockCaptchaFill ?? false,
      blockCredentialSavePrompt: patch.blockCredentialSavePrompt ?? false,
      createdAt: now,
      updatedAt: now,
    })
  }
  await saveBlacklist(list)

}

