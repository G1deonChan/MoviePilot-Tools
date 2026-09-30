// PT 站点浮动下载按钮（内容脚本）
// - 仅在已配置的 PT 站点种子详情页注入固定按钮
// - 点击后将当前详情页地址发送给后台脚本打开下载面板
import { MSG, sendMessage } from '../core/bus'
import { isExtensionContextError, isExtensionContextValid } from '../core/extension-context'
import { STORAGE_KEYS, storageGet } from '../core/storage'
import { getPublicStore, updatePublicStore } from '../core/store-repository'
import { loadStoredSites } from '../services/site-manage'
import { domainsMatch, loadCustomDomainAliases } from '../services/site-domain-alias'
import { fetchSupportingFromBackground } from './site-supporting'
import { normalizeTorrentPageTitle } from '../services/site-torrent'

const CLS = {
  BTN: 'mp-ext-pt-float-btn',
  LOADING: 'mp-ext-pt-float-loading',
  LOADING_ACTIVE: 'mp-ext-pt-float-loading-active',
  TIPS: 'mp-ext-pt-float-tips',
  DRAGGING: 'mp-ext-pt-float-dragging',
  EDGE_LEFT: 'mp-ext-pt-float-edge-left',
  EDGE_RIGHT: 'mp-ext-pt-float-edge-right',
  READY: 'mp-ext-pt-float-ready',
} as const

type FloatPos = { top: number; left?: number; right?: number }

let ptFloatStopped = false

function stopPtFloat(): void {
  ptFloatStopped = true
  document.querySelector('.' + CLS.BTN)?.remove()
}

function runPtFloatTask(task: () => Promise<unknown>): void {
  if (ptFloatStopped || !isExtensionContextValid()) {
    stopPtFloat()
    return
  }
  void task().catch((error) => {
    if (isExtensionContextError(error)) stopPtFloat()
  })
}

function positionOrigin(): string {
  return location.hostname.toLowerCase()
}

async function loadFloatPosition(): Promise<FloatPos | null> {
  return ((await getPublicStore()).ui?.floatPositions?.[positionOrigin()] as FloatPos) || null
}

async function saveFloatPosition(position: FloatPos): Promise<void> {
  await updatePublicStore((draft) => {
    draft.ui = {
      ...(draft.ui || {}),
      floatPositions: { ...(draft.ui?.floatPositions || {}), [positionOrigin()]: position },
    }
  })
}

async function isTorrentDetailDownloadEnabled(): Promise<boolean> {
  try {
    // 配置缺失时默认启用种子详情页下载按钮。
    const cfg = await storageGet<{ torrentDetailDownloadEnabled?: boolean }>(
      STORAGE_KEYS.WEB_EMBED_FEATURES,
    )
    return cfg?.torrentDetailDownloadEnabled !== false
  } catch {
    return true
  }
}

function matchesAllowed(hostname: string, allow: string[]): boolean {
  const h = hostname.toLowerCase()
  return allow.some((d) => {
    const domain = d.toLowerCase()
    return h === domain || h.endsWith('.' + domain)
  })
}

async function getAllowedDomains(): Promise<string[]> {
  const [sites, supporting, aliases] = await Promise.all([
    loadStoredSites(),
    fetchSupportingFromBackground(),
    loadCustomDomainAliases(),
  ])
  if (!Array.isArray(sites) || !sites.length) return []
  const set = new Set<string>()
  for (const s of sites) {
    const d = (s.domain || '').toLowerCase().replace(/^\./, '')
    if (d) set.add(d)
    try {
      if (s.url) {
        const host = new URL(s.url).hostname.toLowerCase()
        if (host) set.add(host)
      }
    } catch {
      /* 配置 URL 无法解析时保留站点 `domain` 与 Supporting 别名结果。 */
    }

    const identity = Object.values(supporting).find((item) =>
      [s.domain, s.url || ''].some((value) => value && domainsMatch(value, item.domain || item.url || '')),
    )
    if (identity) {
      const identityId = identity.id == null ? '' : String(identity.id)
      const identityName = identity.name?.trim().toLowerCase() || ''
      for (const item of Object.values(supporting)) {
        const sameId = identityId && item.id != null && String(item.id) === identityId
        const sameName = identityName && item.name?.trim().toLowerCase() === identityName
        if (sameId || sameName) {
          const host = (item.domain || '').toLowerCase().replace(/^\./, '')
          if (host) set.add(host)
        }
      }
    }
  }
  for (const alias of aliases) {
    if (sites.some((site) => String(site.id) === String(alias.siteId))) set.add(alias.domain)
  }
  return Array.from(set)
}

async function isSupportedSite(): Promise<boolean> {
  try {
    const host = location.hostname.toLowerCase()
    const allow = await getAllowedDomains()
    if (!allow.length) {
      // 无缓存时放宽：只要像详情页就显示（避免未打开过扩展时按钮永远不出现）
      return true
    }
    return matchesAllowed(host, allow)
  } catch {
    return false
  }
}

function isTorrentDetailPage(): boolean {
  try {
    const url = location.href
    const detailPatterns = [
      '/details.php?id=',
      '/detail/',
      '/torrents.php?id=',
      '/torrents-details.php?id=',
      '/torrent/',
      '/torrents/',
      '/download/',
      '/view/',
      '?id=',
      '&id=',
      '?tid=',
      '&tid=',
      '?torrentid=',
      '&torrentid=',
    ]
    return detailPatterns.some((p) => url.includes(p))
  } catch {
    return false
  }
}

function extractPageTitle(): string {
  try {
    const pageTitle = document.title
    if (pageTitle && pageTitle.trim() && !pageTitle.includes('404') && !pageTitle.includes('Not Found')) {
      const cleanTitle = normalizeTorrentPageTitle(pageTitle)
      if (cleanTitle && cleanTitle.length > 3) return cleanTitle
    }

    const titleSelectors = [
      'h1.title',
      'h1',
      '.title',
      '.torrent-title',
      '.movie-title',
      '#title',
      '.detail-title',
      '.content-title',
    ]
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector)
      if (element?.textContent) {
        const title = element.textContent.trim()
        if (title && title.length > 3) return title
      }
    }

    const urlParams = new URLSearchParams(location.search)
    const titleParam = urlParams.get('title') || urlParams.get('name')
    if (titleParam) return decodeURIComponent(titleParam).trim()

    return pageTitle || '未知种子'
  } catch {
    return document.title || '未知种子'
  }
}

function injectStyle(): void {
  const id = 'mp-ext-pt-float-style'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
.${CLS.BTN} {
  position: fixed !important;
  top: 40%;
  right: 12px;
  width: 46px !important;
  height: 46px !important;
  padding: 0 !important;
  background: linear-gradient(180deg, rgba(139, 92, 246, 0.75) 0%, rgba(109, 40, 217, 0.85) 100%) !important;
  backdrop-filter: blur(8px) !important;
  -webkit-backdrop-filter: blur(8px) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 50% !important;
  cursor: pointer !important;
  z-index: 10000000 !important;
  opacity: .75 !important;
  box-shadow: 0 4px 12px rgba(109, 40, 217, 0.25) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: opacity .2s ease, border-radius .2s ease, background .2s ease, box-shadow .2s ease !important;
}
.${CLS.BTN} img {
  width: 21px !important;
  height: 21px !important;
  display: block !important;
  filter: brightness(0) invert(1) !important;
}
.${CLS.BTN}.${CLS.READY} {
  transition: top .25s cubic-bezier(0.25, 0.8, 0.25, 1), left .25s cubic-bezier(0.25, 0.8, 0.25, 1), right .25s cubic-bezier(0.25, 0.8, 0.25, 1), opacity .2s ease, border-radius .2s ease, background .2s ease, box-shadow .2s ease !important;
}
.${CLS.BTN}:hover {
  opacity: 1 !important;
  background: linear-gradient(180deg, rgba(139, 92, 246, 0.9) 0%, rgba(109, 40, 217, 0.95) 100%) !important;
  box-shadow: 0 6px 16px rgba(109, 40, 217, 0.35) !important;
}
.${CLS.DRAGGING} {
  transition: none !important;
  opacity: .8 !important;
  background: linear-gradient(180deg, rgba(139, 92, 246, 0.65) 0%, rgba(109, 40, 217, 0.75) 100%) !important;
}
.${CLS.DRAGGING}:hover {
  opacity: .8 !important;
}
.${CLS.EDGE_RIGHT} {
  border-radius: 23px 0 0 23px !important;
}
.${CLS.EDGE_LEFT} {
  border-radius: 0 23px 23px 0 !important;
}
.${CLS.LOADING} {
  height: 18px !important;
  width: 18px !important;
  border-radius: 50% !important;
  border: 2px solid rgba(255, 255, 255, 0.3) !important;
  border-top: 2px solid #ffffff !important;
  animation: mp-ext-pt-float-spin 0.8s linear infinite !important;
  display: none !important;
  box-sizing: border-box !important;
}
.${CLS.LOADING_ACTIVE} .${CLS.LOADING} {
  display: block !important;
}
.${CLS.LOADING_ACTIVE} img {
  display: none !important;
}
@keyframes mp-ext-pt-float-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.${CLS.TIPS} {
  display: none !important;
  position: absolute !important;
  left: -142px !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  padding: 6px 12px !important;
  font-size: 12px !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  border-radius: 6px !important;
  color: #fff !important;
  background: rgba(15, 23, 42, 0.95) !important;
  backdrop-filter: blur(4px) !important;
  -webkit-backdrop-filter: blur(4px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
  white-space: nowrap !important;
  z-index: 2147483646 !important;
  pointer-events: none !important;
}
.${CLS.TIPS}::after {
  content: '';
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 5px solid rgba(15, 23, 42, 0.95);
}
.${CLS.BTN}:hover .${CLS.TIPS} {
  display: block !important;
}
.${CLS.LOADING_ACTIVE} .${CLS.TIPS} {
  left: -158px !important;
  display: block !important;
}
.${CLS.EDGE_LEFT} .${CLS.TIPS} {
  left: auto !important;
  right: -142px !important;
}
.${CLS.EDGE_LEFT}.${CLS.LOADING_ACTIVE} .${CLS.TIPS} {
  right: -158px !important;
}
.${CLS.EDGE_LEFT} .${CLS.TIPS}::after {
  right: auto;
  left: -5px;
  border-left: none;
  border-right: 5px solid rgba(15, 23, 42, 0.95);
}
`
  document.head.appendChild(style)
}

function savePos(pos: FloatPos): void {
  runPtFloatTask(() => saveFloatPosition(pos))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function applyStoredPos(btn: HTMLElement): Promise<void> {
  try {
    const stored = await loadFloatPosition()
    if (stored && typeof stored.top === 'number') {
      btn.style.top = stored.top + 'px'
      if (typeof stored.left === 'number') {
        btn.style.left = stored.left + 'px'
        btn.style.right = 'auto'
        if ((stored.left ?? 1) <= 0) btn.classList.add(CLS.EDGE_LEFT)
      }
      if (typeof stored.right === 'number') {
        btn.style.right = stored.right + 'px'
        btn.style.left = 'auto'
        if ((stored.right ?? 1) <= 0) btn.classList.add(CLS.EDGE_RIGHT)
      }
    } else {
      btn.style.right = '0px'
      btn.classList.add(CLS.EDGE_RIGHT)
    }
  } catch {
    btn.style.right = '0px'
    btn.classList.add(CLS.EDGE_RIGHT)
  } finally {
    document.body.appendChild(btn)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        btn.classList.add(CLS.READY)
      })
    })
  }
}

function createButton(): void {
  if (document.querySelector('.' + CLS.BTN)) return

  const btn = document.createElement('button')
  btn.className = CLS.BTN
  btn.type = 'button'

  const img = document.createElement('img')
  img.width = 24
  img.height = 24
  img.alt = ''
  try {
    // 浮窗资源必须列入 Manifest 的 web_accessible_resources。
    img.src = chrome.runtime.getURL('icons/icon.png')
  } catch {
    try {
      img.src = chrome.runtime.getURL('icons/icon-48.png')
    } catch {
      img.src = ''
    }
  }
  btn.appendChild(img)

  const loading = document.createElement('div')
  loading.className = CLS.LOADING
  btn.appendChild(loading)

  const tips = document.createElement('div')
  tips.className = CLS.TIPS
  tips.textContent = 'MoviePilot推送下载'
  btn.appendChild(tips)

  let moved = false
  let dragging = false
  let startX = 0
  let startY = 0
  let startTop = 0
  let startLeft = 0

  btn.addEventListener('click', () => {
    if (dragging || moved) {
      moved = false
      return
    }
    btn.disabled = true
    btn.classList.add(CLS.LOADING_ACTIVE)
    tips.textContent = '正在打开下载...'

    const pageTitle = extractPageTitle()
    runPtFloatTask(async () => {
      try {
        const result = await sendMessage<{ success?: boolean; error?: string }>(MSG.PT_OPEN_DOWNLOAD, {
          url: location.href,
          title: pageTitle,
        })
        if (result?.success === false) console.warn('[MP] 打开下载面板失败', result.error)
      } finally {
        if (btn.isConnected) {
          btn.disabled = false
          btn.classList.remove(CLS.LOADING_ACTIVE)
          tips.textContent = 'MoviePilot推送下载'
        }
      }
    })
  })

  runPtFloatTask(() => applyStoredPos(btn))

  btn.addEventListener('mousedown', (ev) => {
    dragging = true
    moved = false
    btn.classList.add(CLS.DRAGGING)
    btn.classList.remove(CLS.EDGE_LEFT, CLS.EDGE_RIGHT)
    startX = ev.clientX
    startY = ev.clientY
    const rect = btn.getBoundingClientRect()
    startTop = rect.top
    startLeft = rect.left
    btn.style.left = rect.left + 'px'
    btn.style.top = rect.top + 'px'
    btn.style.right = 'auto'
    ev.preventDefault()
  })

  window.addEventListener('mousemove', (ev) => {
    if (!dragging) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true
    const vw = window.innerWidth
    const vh = window.innerHeight
    const newLeft = clamp(startLeft + dx, 4, vw - 50)
    const newTop = clamp(startTop + dy, 4, vh - 50)
    btn.style.left = newLeft + 'px'
    btn.style.top = newTop + 'px'
  })

  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    btn.classList.remove(CLS.DRAGGING)
    const rect = btn.getBoundingClientRect()
    const vw = window.innerWidth
    const centerX = rect.left + rect.width / 2
    const snapRight = centerX > vw / 2
    btn.style.top = clamp(rect.top, 4, window.innerHeight - rect.height - 4) + 'px'
    if (snapRight) {
      const right = 0
      btn.style.right = right + 'px'
      btn.style.left = 'auto'
      btn.classList.remove(CLS.EDGE_LEFT)
      btn.classList.add(CLS.EDGE_RIGHT)
      savePos({ top: parseFloat(btn.style.top), right })
    } else {
      const left = 0
      btn.style.left = left + 'px'
      btn.style.right = 'auto'
      btn.classList.remove(CLS.EDGE_RIGHT)
      btn.classList.add(CLS.EDGE_LEFT)
      savePos({ top: parseFloat(btn.style.top), left })
    }
  })
}

async function init(): Promise<void> {
  if (ptFloatStopped || !isExtensionContextValid()) {
    stopPtFloat()
    return
  }
  if (!(await isTorrentDetailDownloadEnabled())) return
  if (!isTorrentDetailPage()) return
  if (!(await isSupportedSite())) return
  if (ptFloatStopped || !isExtensionContextValid()) {
    stopPtFloat()
    return
  }
  injectStyle()
  createButton()
}

export function initPtFloat(): void {
  if (window.self !== window.top) return
  if (document.body) {
    runPtFloatTask(init)
    return
  }
  const observer = new MutationObserver((_, obs) => {
    if (document.body) {
      obs.disconnect()
      runPtFloatTask(init)
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      observer.disconnect()
      runPtFloatTask(init)
    },
    { once: true },
  )
}
