// MP 页面桥接：
// 1) 接收 popup 下发的凭据/TOTP 填充指令（PT 站）
// 2) 插件管理 iframe 内嵌时：隐藏多余页面组件、同步主题/内部背景、上报路由变化
import { MSG } from '../core/bus'
import { addRuntimeMessageListener } from '../core/extension-context'
import {
  getPluginEmbedNonce,
  getPluginEmbedParam,
  isPluginEmbedCandidate as isPluginEmbedCandidateUrl,
} from '../core/plugin-embed'

interface FillPayload {
  username?: string
  password?: string
  code?: string
}

export function initMpBridge(): void {
  addRuntimeMessageListener((msg, _sender, sendResponse) => {
    if (msg?.type === MSG.FILL_CREDENTIAL) {
      fillCredential(msg.payload as FillPayload)
      sendResponse({ ok: true })
      return true
    }
    if (msg?.type === MSG.FILL_TOTP) {
      fillTotp((msg.payload as FillPayload)?.code)
      sendResponse({ ok: true })
      return true
    }
    return false
  })
  // 再保险：DOM 就绪后再次建立不透明嵌入底色（document_start 可能已跑过）
  tryEarlyMpEmbedGlass()
  initPluginEmbed()
}

/** document_start 尽早建立不透明底色，避免 MP 启动层短暂透出父窗口。 */
export function tryEarlyMpEmbedGlass(): void {
  try {
    if (!isPluginEmbedCandidate()) return
    const root = document.documentElement
    root.style.setProperty('background', '#f4f7fb', 'important')
    root.style.setProperty('background-color', '#f4f7fb', 'important')
    root.style.setProperty('--initial-loader-bg', '#f4f7fb')
  } catch {
    /* 初始底色设置失败时保留页面原始样式，不阻断嵌入页加载。 */
  }
}

function fillCredential(p: FillPayload): void {
  if (!p) return
  const u = document.querySelector<HTMLInputElement>(
    'input[type="text"], input[type="email"], input[name*="user" i], input[id*="user" i]',
  )
  const pw = document.querySelector<HTMLInputElement>('input[type="password"]')
  if (u && p.username) {
    u.value = p.username
    u.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (pw && p.password) {
    pw.value = p.password
    pw.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function fillTotp(code?: string): void {
  if (!code) return
  const inp = document.querySelector<HTMLInputElement>(
    'input[name*="totp" i], input[id*="totp" i], input[inputmode="numeric"][maxlength="6"]',
  )
  if (inp) {
    inp.value = code
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

// 插件管理 iframe 内嵌处理

function isInIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/** 插件列表路由（/#/plugins…）；详情/page/config 为 /#/plugin… */
function isPluginsListRoute(): boolean {
  const hash = (location.hash || '').toLowerCase()
  return /#\/plugins(?:[/?]|$)/.test(hash)
}

function getExtensionOrigin(): string {
  try {
    return new URL(chrome.runtime.getURL('/')).origin
  } catch {
    return ''
  }
}

function getEmbedNonce(): string {
  return getPluginEmbedNonce(location.href)
}

function isPluginEmbedCandidate(): boolean {
  return isPluginEmbedCandidateUrl(location.href, isInIframe())
}

function isTrustedPluginEmbed(): boolean {
  return isPluginEmbedCandidate()
}

interface EmbedAppearance {
  theme: 'light' | 'dark'
  background: {
    enabled: boolean
    image: string
    opacity: number
    blurEnabled: boolean
    blur: number
  }
}

let currentTheme: 'light' | 'dark' = 'light'
let themeObserver: MutationObserver | null = null
let appearanceSignature = ''

function getQueryParam(name: string): string | null {
  return getPluginEmbedParam(location.href, name)
}

/** 只校正布局壳主题类，禁止全树翻转 .v-theme--*（会打坏 Page/Config 表单控件） */
function correctVuetifyThemes(): void {
  try {
    const wantDark = currentTheme === 'dark'
    const from = wantDark ? 'v-theme--light' : 'v-theme--dark'
    const to = wantDark ? 'v-theme--dark' : 'v-theme--light'
    // 仅触碰页面骨架节点，绝不 querySelectorAll 深层组件
    const shells: Array<Element | null> = [
      document.documentElement,
      document.body,
      document.getElementById('app'),
      document.querySelector('.v-application'),
      document.querySelector('.v-application__wrap'),
      document.querySelector('.v-layout'),
      document.querySelector('.v-main'),
    ]
    for (const el of shells) {
      if (!el) continue
      if (el.classList.contains(from)) {
        el.classList.remove(from)
        el.classList.add(to)
      }
    }
  } catch {
    /* 布局壳主题校正失败时保留 MoviePilot 当前主题类。 */
  }
}

function ensureStyleAtBottom(): void {
  try {
    const minimal = document.getElementById('mp-embed-minimal-style')
    const appearance = document.getElementById('mp-embed-appearance-style')
    if (appearance?.parentElement) {
      if (appearance.parentElement.lastElementChild !== appearance) {
        appearance.parentElement.appendChild(appearance)
      }
      if (minimal && appearance.previousElementSibling !== minimal) {
        appearance.parentNode?.insertBefore(minimal, appearance)
      }
    } else if (minimal?.parentElement && minimal.parentElement.lastElementChild !== minimal) {
      minimal.parentElement.appendChild(minimal)
    }
  } catch {
    /* 样式节点顺序调整失败时保留当前层叠顺序，不阻断嵌入页交互。 */
  }
}

function startThemeObserver(): void {
  if (!isTrustedPluginEmbed() || themeObserver) return
  try {
    // 仅监听 html 自身 class/data-theme，避免子树表单 focus/菜单 触发主题重写
    themeObserver = new MutationObserver(() => {
      const root = document.documentElement
      if (currentTheme === 'dark' && root.getAttribute('data-theme') !== 'dark') {
        root.setAttribute('data-theme', 'dark')
        root.classList.remove('v-theme--light', 'theme-light')
        root.classList.add('v-theme--dark', 'theme-dark')
        root.style.colorScheme = 'dark'
        correctVuetifyThemes()
      } else if (currentTheme === 'light' && root.getAttribute('data-theme') !== 'light') {
        root.setAttribute('data-theme', 'light')
        root.classList.remove('v-theme--dark', 'theme-dark')
        root.classList.add('v-theme--light', 'theme-light')
        root.style.colorScheme = 'light'
        correctVuetifyThemes()
      }
      ensureStyleAtBottom()
      hideAgentAssistantInEmbed()
    })
    themeObserver.observe(document.documentElement, {
      childList: false,
      subtree: false,
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
  } catch {
    /* 主题监听器注册失败时保留当前已应用主题，不阻断嵌入页加载。 */
  }
}

function applyTheme(theme: 'light' | 'dark'): void {
  currentTheme = theme
  try {
    const root = document.documentElement
    const body = document.body
    if (theme === 'dark') {
      root.classList.remove('v-theme--light', 'theme-light')
      root.classList.add('v-theme--dark', 'theme-dark')
      root.setAttribute('data-theme', 'dark')
      root.style.colorScheme = 'dark'
      body?.classList.remove('v-theme--light', 'theme-light')
      body?.classList.add('v-theme--dark', 'theme-dark')
      body?.setAttribute('data-theme', 'dark')
    } else {
      root.classList.remove('v-theme--dark', 'theme-dark')
      root.classList.add('v-theme--light', 'theme-light')
      root.setAttribute('data-theme', 'light')
      root.style.colorScheme = 'light'
      body?.classList.remove('v-theme--dark', 'theme-dark')
      body?.classList.add('v-theme--light', 'theme-light')
      body?.setAttribute('data-theme', 'light')
    }
    correctVuetifyThemes()
    ensureStyleAtBottom()
  } catch {
    /* 主题同步失败时保留页面当前主题状态，后续父窗口消息仍可重试。 */
  }
}

// 隐藏导航栏/页脚等原生外壳，仅保留插件内容
function applyMinimalUI(): void {
  try {
    if (!isTrustedPluginEmbed()) return
    const id = 'mp-embed-minimal-style'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    const shellColors = `
      html {
        --agent-assistant-fab-offset: 0px !important;
      }
      /* 默认实色底；自定义背景启用时由 appearance 样式仅让布局壳透出 iframe 内背景。 */
      html[data-theme="dark"],
      html[data-theme="dark"] body,
      html[data-theme="dark"] #app,
      html[data-theme="dark"] .v-application,
      html[data-theme="dark"] .v-application__wrap,
      html[data-theme="dark"] .v-layout,
      html[data-theme="dark"] .v-main {
        background-color: #121212 !important;
      }
      html[data-theme="light"],
      html[data-theme="light"] body,
      html[data-theme="light"] #app,
      html[data-theme="light"] .v-application,
      html[data-theme="light"] .v-application__wrap,
      html[data-theme="light"] .v-layout,
      html[data-theme="light"] .v-main {
        background-color: #f4f7fb !important;
      }
`
    style.textContent = `
      .theme-navbar-row, .v-layout .d-flex.h-14.align-center.mx-1 { display: none !important; }
      .v-layout .main-content-wrapper { padding-top: 0 !important; }
      .footer-nav-container { display: none !important; }
      footer.layout-footer,
      .footer-content-container,
      .footer-content-container-noheight {
        display: none !important; height: 0 !important; padding: 0 !important; margin: 0 !important;
      }
      header.layout-navbar.navbar-blur {
        height: 50px !important; min-height: 50px !important; --navbar-tab-height: 0px !important; overflow: hidden !important;
      }
      header.layout-navbar.navbar-blur .navbar-content-container {
        block-size: 50px !important; height: 50px !important; padding-block-start: 0 !important; padding-block-end: 0 !important;
      }
      header.layout-navbar .navbar-content-container > * { margin-block-start: 0 !important; margin-block-end: 0 !important; }
      /* 扩展插件管理 iframe：屏蔽智能助手悬浮小人/气泡/面板（勿选 [data-agent-assistant-open]，该属性挂在 html 上） */
      .agent-assistant-fab,
      .agent-assistant-fab.is-docked,
      .agent-assistant-fab__bot,
      .agent-assistant-fab__trigger,
      .agent-assistant-fab__bubble,
      .agent-assistant-fab__bubbles,
      .agent-assistant-fab__bubble-stack,
      [class*="agent-assistant-fab"],
      .agent-assistant-panel,
      .agent-assistant-shell,
      .agent-assistant-header,
      .v-navigation-drawer.agent-assistant-panel,
      .v-navigation-drawer[class*="agent-assistant"],
      .v-overlay.agent-assistant-panel,
      .v-overlay [class*="agent-assistant-panel"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        max-width: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
        z-index: -1 !important;
      }
      ${shellColors}
    `
    ;(document.head || document.documentElement).appendChild(style)
  } catch {
    /* 最小界面样式注入失败时保留 MoviePilot 原生页面外壳。 */
  }
}

/** 动态 DOM 挂载后再次隐藏智能助手悬浮层（仅 iframe 插件路由） */
function hideAgentAssistantInEmbed(): void {
  try {
    if (!isTrustedPluginEmbed()) return
    const selectors = [
      '.agent-assistant-fab',
      '[class*="agent-assistant-fab"]',
      '.agent-assistant-panel',
      '.agent-assistant-shell',
      '.v-navigation-drawer[class*="agent-assistant"]',
      '.v-overlay.agent-assistant-panel',
    ]
    document.querySelectorAll(selectors.join(',')).forEach((el) => {
      const node = el as HTMLElement
      node.style.setProperty('display', 'none', 'important')
      node.style.setProperty('visibility', 'hidden', 'important')
      node.style.setProperty('pointer-events', 'none', 'important')
      node.setAttribute('data-mp-embed-hide-agent', '1')
    })
  } catch {
    /* 智能助手节点隐藏失败时保留宿主原状，不阻断插件页面交互。 */
  }
}

function appearanceKey(appearance: EmbedAppearance): string {
  const bg = appearance.background
  return [
    appearance.theme,
    bg.enabled ? '1' : '0',
    bg.image,
    bg.opacity,
    bg.blurEnabled ? bg.blur : 0,
    isPluginsListRoute() ? 'list' : 'detail',
  ].join('|')
}

/**
 * 在 iframe 内绘制固定背景副本。最底层始终是不透明基底，避免 iframe 与父窗口实时 Alpha 合成。
 * 插件列表页的布局壳仅透出该内部背景；详情/config 页面保持原生实色 surface。
 */
function applyEmbedAppearance(appearance: EmbedAppearance): void {
  try {
    if (!isTrustedPluginEmbed()) return
    currentTheme = appearance.theme
    const signature = appearanceKey(appearance)
    if (signature === appearanceSignature) return
    appearanceSignature = signature

    const root = document.documentElement
    const body = document.body
    const useBackground = appearance.background.enabled && isPluginsListRoute()
    const baseColor = appearance.theme === 'dark' ? '#121212' : '#f4f7fb'
    root.style.setProperty('background', baseColor, 'important')
    root.style.setProperty('background-color', baseColor, 'important')
    root.style.setProperty('--initial-loader-bg', baseColor)
    body?.style.setProperty('background', baseColor, 'important')
    body?.style.setProperty('background-color', baseColor, 'important')
    root.toggleAttribute('data-mp-embed-background', useBackground)

    let background = document.getElementById('mp-embed-background') as HTMLDivElement | null
    if (!background) {
      background = document.createElement('div')
      background.id = 'mp-embed-background'
      ;(body || document.documentElement).prepend(background)
    }
    background.style.setProperty('--mp-embed-image', `url("${appearance.background.image}")`)
    background.style.setProperty('--mp-embed-opacity', String(appearance.background.opacity))
    background.style.setProperty(
      '--mp-embed-filter',
      appearance.background.blurEnabled ? `blur(${appearance.background.blur}px)` : 'none',
    )
    background.hidden = !useBackground

    const id = 'mp-embed-appearance-style'
    let style = document.getElementById(id) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = id
      style.textContent = `
        html, body {
          min-width: 0 !important;
          min-height: 100% !important;
        }
        body {
          isolation: isolate;
        }
        #app {
          position: relative;
          z-index: 1;
        }
        #mp-embed-background {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background: #f4f7fb;
          contain: strict;
        }
        #mp-embed-background::before {
          position: absolute;
          inset: -24px;
          background-image: var(--mp-embed-image);
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
          content: '';
          filter: var(--mp-embed-filter);
          opacity: var(--mp-embed-opacity);
        }
        #mp-embed-background::after {
          position: absolute;
          inset: 0;
          background: rgba(246, 249, 255, 0.15);
          content: '';
        }
        html[data-mp-embed-background],
        html[data-mp-embed-background] body,
        html[data-mp-embed-background] #app,
        html[data-mp-embed-background] .v-application,
        html[data-mp-embed-background] .v-application__wrap,
        html[data-mp-embed-background] .v-layout,
        html[data-mp-embed-background] .v-main,
        html[data-mp-embed-background] .main-content-wrapper,
        html[data-mp-embed-background] .page-content-container,
        html[data-mp-embed-background] .layout-page-content,
        html[data-mp-embed-background] .layout-content-wrapper {
          background: transparent !important;
          background-color: transparent !important;
        }
        html[data-mp-embed-background] #loading-bg,
        html[data-mp-embed-background] #loading-bg .loading-shell,
        html[data-mp-embed-background] #loading-bg .loading-main,
        html[data-mp-embed-background] #loading-bg .loading-footer {
          background: transparent !important;
          background-color: transparent !important;
        }
        html[data-mp-embed-background] .v-overlay .v-overlay__content > .v-card,
        html[data-mp-embed-background] .v-dialog .v-overlay__content > .v-card,
        html[data-mp-embed-background] .v-bottom-sheet .v-overlay__content > .v-card {
          background-color: rgb(var(--v-theme-surface)) !important;
          background-image: none !important;
          backdrop-filter: none !important;
        }
        @media (width <= 599px) {
          .layout-page-content {
            padding-inline: 0.25rem !important;
          }
          .layout-page-content .page-content-container > div:first-child {
            inline-size: 100% !important;
            min-inline-size: 0 !important;
          }
          .disable-tab-transition.px-2 {
            padding-inline: 0.25rem !important;
          }
          .grid-plugin-card {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .compact-fab-stack {
            inset-block-end: 0.75rem !important;
            inset-inline-end: 0.75rem !important;
          }
        }
      `
      ;(document.head || document.documentElement).appendChild(style)
    }
    ensureStyleAtBottom()
  } catch {
    /* 外观同步失败时保留当前实色基底与既有样式，后续消息仍可重试。 */
  }
}

function cleanupMinimalUI(): void {
  document.getElementById('mp-embed-minimal-style')?.remove()
}
function cleanupEmbedAppearance(): void {
  appearanceSignature = ''
  document.documentElement.removeAttribute('data-mp-embed-background')
  document.getElementById('mp-embed-background')?.remove()
  document.getElementById('mp-embed-appearance-style')?.remove()
}

const INJECTED_MARK = 'mp_tool_injected' // 记录本次注入的 token，关闭时仅清理自己写入的登录态
const RELOAD_MARK = 'mp_tool_reloading' // 区分「注入触发的 reload」与「真实关闭」

// 把父窗口传来的 mp_token + 用户档案写入 MP 页 localStorage（auth/user 两个 store），实现自动登录
function applyAuthPayload(token: string, user: Record<string, unknown> | null): boolean {
  try {
    const cur = (() => {
      try {
        return JSON.parse(localStorage.getItem('auth') || '{}').token
      } catch {
        return null
      }
    })()
    if (cur === token) return true // 已注入，当前页面不会再因鉴权刷新
    localStorage.setItem('auth', JSON.stringify({ token, remember: true, originalPath: null }))
    const persistUser = (p: Record<string, unknown>) => {
      localStorage.setItem('user', JSON.stringify({
        superUser: !!(p.superUser || p.is_superuser),
        userID: (p.userID as number) ?? (p.id as number) ?? -1,
        userName: (p.userName as string) || (p.name as string) || '',
        avatar: (p.avatar as string) || '',
        level: (p.level as number) ?? 2,
        permissions: (p.permissions as Record<string, boolean>) || {},
        wizard: false,
      }))
    }
    // 标记本次注入，便于关闭时只清理扩展写入的登录态（不误清用户真实手动登录）
    localStorage.setItem(INJECTED_MARK, token)
    if (user && user.userName) {
      persistUser(user)
      sessionStorage.setItem(RELOAD_MARK, '1')
      window.location.reload()
      return false
    } else {
      // 兜底：用 Bearer 拉当前用户档案（同源 /api/v1/user/current）
      fetch('/api/v1/user/current', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (info) persistUser(info as Record<string, unknown>)
          sessionStorage.setItem(RELOAD_MARK, '1')
          window.location.reload()
        })
        .catch(() => {
          sessionStorage.setItem(RELOAD_MARK, '1')
          window.location.reload()
        })
      return false
    }
  } catch {
    return true
  }
}

// 关闭插件页（iframe 卸载）时，仅清理扩展自己注入的 MP 登录态，避免污染浏览器内 MP Web 端
function cleanupInjected(): void {
  try {
    const injected = localStorage.getItem(INJECTED_MARK)
    if (!injected) return
    let cur: string | null = null
    try {
      cur = JSON.parse(localStorage.getItem('auth') || '{}').token
    } catch {
      cur = null
    }
    // 仅当当前登录态仍是我们注入的 token 时才移除，防止误清用户真实手动登录
    if (cur === injected) {
      localStorage.removeItem('auth')
      localStorage.removeItem('user')
    }
    localStorage.removeItem(INJECTED_MARK)
  } catch {
    /* 页面卸载期间存储可能不可用；清理失败不阻断宿主页面关闭。 */
  }
}

function registerUnloadCleanup(): void {
  let handled = false
  const onUnload = () => {
    // 一次卸载只处理一次（pagehide/beforeunload 会先后触发，避免重复执行）
    if (handled) return
    handled = true
    // 注入触发的 reload 不算关闭，跳过清理
    if (sessionStorage.getItem(RELOAD_MARK) === '1') {
      sessionStorage.removeItem(RELOAD_MARK)
      return
    }
    cleanupInjected()
  }
  window.addEventListener('pagehide', onUnload)
  window.addEventListener('beforeunload', onUnload)
}




// 插件数据页可能再内嵌 iframe，卡死时给出重试/新标签打开提示
const deadTimers = new WeakMap<HTMLIFrameElement, number>()
const deadHinted = new WeakSet<HTMLIFrameElement>()

function isPluginIframe(el: HTMLIFrameElement): boolean {
  return /\/plugin\//.test(el.getAttribute('src') || '') || /\bplugin\b/i.test(el.getAttribute('src') || '')
}

function showDeadHint(iframe: HTMLIFrameElement): void {
  if (deadHinted.has(iframe)) return
  deadHinted.add(iframe)
  try {
    const tip = document.createElement('div')
    tip.style.cssText =
      'margin:8px 0;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff7ed;color:#92400e;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;'
    const text = document.createElement('div')
    text.textContent = '插件页面可能加载异常'
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;'
    const retry = document.createElement('button')
    retry.textContent = '重试'
    retry.style.cssText = 'padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;'
    retry.onclick = () => {
      deadHinted.delete(iframe)
      const src = iframe.src
      iframe.src = src
      tip.remove()
    }
    const open = document.createElement('button')
    open.textContent = '新标签打开'
    open.style.cssText = 'padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;'
    open.onclick = () => window.open(iframe.src, '_blank')
    actions.append(retry, open)
    tip.append(text, actions)
    iframe.parentElement?.parentElement?.insertBefore(tip, iframe.parentElement)
  } catch {
    /* 加载异常提示注入失败时不干预原 iframe，用户仍可使用页面原生行为。 */
  }
}

function watchPluginIframes(iframes?: HTMLIFrameElement[]): void {
  try {
    const list = iframes || (Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[])
    for (const el of list) {
      if (!isPluginIframe(el) || deadTimers.has(el)) continue
      const clear = () => {
        const t = deadTimers.get(el)
        if (typeof t === 'number') window.clearTimeout(t)
        deadTimers.delete(el)
      }
      el.addEventListener('load', clear, { once: true })
      el.addEventListener('error', clear, { once: true })
      const tid = window.setTimeout(() => {
        deadTimers.delete(el)
        showDeadHint(el)
      }, 12000)
      deadTimers.set(el, tid)
    }
  } catch {
    /* 宿主页面 DOM 状态异常时跳过失效提示监控，不阻断插件 iframe 本身加载。 */
  }
}

function initPluginEmbed(): void {
  if (!isTrustedPluginEmbed()) return
  const extensionOrigin = getExtensionOrigin()
  const embedNonce = getEmbedNonce()
  if (!extensionOrigin || !embedNonce) return
  const theme = getQueryParam('theme')
  if (theme === 'dark' || theme === 'light') currentTheme = theme

  const postParent = (type: string): void => {
    window.parent.postMessage({ type, embedNonce }, extensionOrigin)
  }

  let activated = false
  const activateEmbed = (): void => {
    if (activated) return
    activated = true
    applyTheme(currentTheme)
    applyMinimalUI()
    hideAgentAssistantInEmbed()
    startThemeObserver()
    watchPluginIframes()
    registerUnloadCleanup()
    // 前端 Widget 可能晚于 bridge 挂载，延迟再藏一次悬浮助手
    window.setTimeout(() => hideAgentAssistantInEmbed(), 500)
    window.setTimeout(() => hideAgentAssistantInEmbed(), 2000)
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== extensionOrigin) return
    const data = event.data as {
      type?: string
      embedNonce?: string
      theme?: 'light' | 'dark'
      appearance?: EmbedAppearance
      token?: string
      user?: Record<string, unknown> | null
    } | null
    if (!data?.type || data.embedNonce !== embedNonce) return
    activateEmbed()
    if (data.type === 'MP_THEME_CHANGE' && data.theme) applyTheme(data.theme)
    else if (data.type === 'MP_IFRAME_SET_APPEARANCE' && data.appearance) {
      applyEmbedAppearance(data.appearance)
      postParent('MP_IFRAME_APPEARANCE_READY')
    } else if (data.type === 'MP_IFRAME_AUTH' && data.token) {
      if (applyAuthPayload(data.token, data.user ?? null)) {
        postParent('MP_IFRAME_AUTH_READY')
      }
    } else if (data.type === 'MP_IFRAME_LOGOUT') {
      cleanupInjected()
    }
  })

  // 主动向可信父窗口请求主题、外观与凭据
  postParent('MP_IFRAME_NEED_THEME')
  postParent('MP_IFRAME_NEED_APPEARANCE')
  postParent('MP_IFRAME_NEED_AUTH')

  const onRouteChange = () => {
    appearanceSignature = ''
    postParent('MP_IFRAME_NEED_APPEARANCE')
  }
  window.addEventListener('hashchange', onRouteChange)
  window.addEventListener('popstate', onRouteChange)
  window.addEventListener('beforeunload', () => {
    themeObserver?.disconnect()
    themeObserver = null
    cleanupMinimalUI()
    cleanupEmbedAppearance()
  })
}
