// 验证码 + TOTP 自动填充（content script）
// 自动检测并填充 TOTP 和图片验证码，支持识别提示与结果纠正。
import { recognizeCaptcha, upsertCorrection } from '../services/captcha'
import { generateTotp } from '../services/totp'
import { getWebEmbedFeaturesConfig } from '../core/web-embed-features'
import type { TotpSite } from '../core/types'
import { loadBlacklist } from '../services/credential'
import { loadSites } from '../services/totp'
import {
  buildDomainAliasIndex,
  domainsMatch,
  findSiteIdsByDomain,
  loadCustomDomainAliases,
} from '../services/site-domain-alias'
import { getPublicStore } from '../core/store-repository'
import { captureCaptchaImage } from './captcha-image'
import { fetchSupportingFromBackground } from './site-supporting'

const TAG = '[MP TOTP/Captcha]'

// 两步验证自动填充
// 已匹配站点后，等待输入框出现的轮询超时次数
const TOTP_INPUT_MAX_ATTEMPTS = 5
// DOM 变化防抖，避免每次 mutation 全量扫描
const TOTP_DOM_DEBOUNCE_MS = 350
// 等待输入框的备用轮询间隔（主路径靠 mutation / focus）
const TOTP_INPUT_POLL_MS = 1200

const TOTP_INPUT_IDS = [
  'otpCode', 'otp_code', 'otp-code', 'totp', 'twoFactorCode', 'two_factor_code',
  'authenticator_code', 'verify_code', '2fa', 'twofa',
]
const TOTP_INPUT_NAMES = [
  '2fa_secret', 'two_factor_code', 'two_step_code', 'twostep_code', 'verify_code',
  'otp', 'totp', 'two_factor', '2fa', 'twofa', 'twostep', 'otp_code', '2fa_code', 'form_item__2fa',
]

type TotpTarget = HTMLInputElement | HTMLInputElement[]
type TotpProcessResult = 'filled' | 'wait_input' | 'stop' | 'busy'

let totpFilled = false
let isTotpProcessing = false
// 已匹配站点但尚未找到输入框时的轮询计数
let totpInputWaitCount = 0
let totpFillTimer: ReturnType<typeof setInterval> | null = null
let totpObserver: MutationObserver | null = null
let totpDomDebounce: ReturnType<typeof setTimeout> | null = null
let totpUrlListenerBound = false
let totpFocusListenerBound = false
let totpStopped = false

// 缓存站点列表 / 匹配结果 / 黑名单，避免每次重试读 storage、刷日志
let cachedSites: TotpSite[] | null = null
let cachedMatchedSite: TotpSite | null | undefined = undefined // undefined = 未判定
let cachedBlacklisted: boolean | null = null
let loggedNoSites = false
let loggedNoMatch = false
let loggedWaitInput = false
let loggedCandidates = false

function log(...args: unknown[]): void {
  console.log(TAG, ...args)
}

export function initCaptchaAutoFill(): void {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const cfg = await getWebEmbedFeaturesConfig()
  log('WEB 嵌入配置', {
    totpAutoFillEnabled: cfg.totpAutoFillEnabled,
    captchaAutoFillEnabled: cfg.captchaAutoFillEnabled,
  })
  if (cfg.totpAutoFillEnabled) {
    // 快速判定：无站点/无匹配则立刻停，不进入重试循环
    await kickoffTotpAutoFill()
  }
  if (cfg.captchaAutoFillEnabled) {
    if (await isCaptchaBlockedForHost()) {
      log('当前站点 captcha 黑名单，跳过图片验证码自动识别')
      return
    }
    startCaptchaAutoFill(cfg.captchaOfflineOcrEnabled)
  }
}

async function isCaptchaBlockedForHost(): Promise<boolean> {
  if (cachedBlacklisted != null) return cachedBlacklisted
  try {
    const list = await loadBlacklist()
    const host = location.hostname.toLowerCase().replace(/^www\./, '')
    // 仅当条目显式开启 blockCaptchaFill 时拦截
    cachedBlacklisted = list.some((e) => {
      if (e?.blockCaptchaFill !== true) return false
      const d = (e.domain || '').toLowerCase().trim().replace(/^www\./, '')
      if (!d) return false
      return d === host || host.endsWith('.' + d) || d.endsWith('.' + host)
    })
  } catch {
    cachedBlacklisted = false
  }
  return cachedBlacklisted
}

// 首次启动：无站点/无匹配则停；仅「等输入框」时挂轻量监听
async function kickoffTotpAutoFill(): Promise<void> {
  // SPA 路由变化始终监听（即使当前页未匹配站点）
  setupTotpUrlChangeListener()
  const result = await processTotp()
  if (result === 'filled' || result === 'stop') return
  // wait_input：输入框可能后出，再挂轻量监听
  setupTotpFocusListener()
  setupTotpDomObserver()
  startTotpInputPolling()
}

function startTotpInputPolling(): void {
  if (totpFillTimer || totpFilled || totpStopped) return
  totpFillTimer = setInterval(() => {
    if (totpFilled || totpStopped) {
      stopTotpAutoFill()
      return
    }
    void scheduleTotpAttempt('poll')
  }, TOTP_INPUT_POLL_MS)
}

// 停止重试监听（保留 URL 监听，便于 SPA 换页后再判定）
function stopTotpAutoFill(): void {
  totpStopped = true
  if (totpFillTimer) {
    clearInterval(totpFillTimer)
    totpFillTimer = null
  }
  if (totpDomDebounce) {
    clearTimeout(totpDomDebounce)
    totpDomDebounce = null
  }
  if (totpObserver) {
    totpObserver.disconnect()
    totpObserver = null
  }
}

function clearTotpTimersOnly(): void {
  if (totpFillTimer) {
    clearInterval(totpFillTimer)
    totpFillTimer = null
  }
  if (totpDomDebounce) {
    clearTimeout(totpDomDebounce)
    totpDomDebounce = null
  }
  if (totpObserver) {
    totpObserver.disconnect()
    totpObserver = null
  }
}

function resetTotpAutoFill(): void {
  if (totpFilled) return
  // URL 变化：清空匹配缓存与停止态，重新快速判定
  totpInputWaitCount = 0
  totpStopped = false
  cachedMatchedSite = undefined
  cachedBlacklisted = null
  loggedNoMatch = false
  loggedWaitInput = false
  loggedCandidates = false
  clearTotpTimersOnly()
  void kickoffTotpAutoFill()
}

function scheduleTotpAttempt(reason: 'poll' | 'dom' | 'focus'): void {
  if (totpFilled || totpStopped || isTotpProcessing) return
  void (async () => {
    const result = await processTotp()
    // 仅 poll 计入超时；DOM/focus 不耗尽次数，避免页面抖动提前停
    if (result === 'wait_input' && reason === 'poll') {
      totpInputWaitCount += 1
      if (totpInputWaitCount >= TOTP_INPUT_MAX_ATTEMPTS) {
        log('等待两步验证输入框超时，停止检测')
        stopTotpAutoFill()
      }
    }
  })()
}

async function loadTotpSites(): Promise<TotpSite[]> {
  if (cachedSites) return cachedSites
  try {
    const list = await loadSites()
    if (Array.isArray(list)) {
      cachedSites = list
      return list
    }
  } catch (error) {
    log('读取统一 TOTP 私有仓失败', error)
  }
  cachedSites = []
  return cachedSites
}

async function processTotp(): Promise<TotpProcessResult> {
  if (totpFilled || totpStopped) return 'stop'
  if (isTotpProcessing) return 'busy'

  isTotpProcessing = true
  try {
    if (await isCaptchaBlockedForHost()) {
      log('当前站点在黑名单中，跳过两步验证码自动填充')
      stopTotpAutoFill()
      return 'stop'
    }

    const sites = await loadTotpSites()
    if (!sites.length) {
      if (!loggedNoSites) {
        log('未配置 TOTP 站点，跳过两步验证填充')
        loggedNoSites = true
      }
      stopTotpAutoFill()
      return 'stop'
    }

    if (cachedMatchedSite === undefined) {
      cachedMatchedSite = await matchTotpSite(sites)
    }
    const site = cachedMatchedSite
    if (!site) {
      if (!loggedNoMatch) {
        log('当前页面未匹配到 TOTP 站点:', location.hostname, {
          configured: sites.map((s) => ({ name: s.name, domain: s.domain, url: s.url })),
        })
        loggedNoMatch = true
      }
      // 无匹配站点：无需继续找输入框
      stopTotpAutoFill()
      return 'stop'
    }

    const target = findTotpTarget()
    if (!target) {
      if (!loggedWaitInput) {
        log('已匹配站点，等待两步验证输入框出现…', site.name)
        loggedWaitInput = true
      }
      return 'wait_input'
    }

    if (!Array.isArray(target) && target.value && target.value.trim()) {
      const existing = target.value.trim()
      if (/^\d{6}(\d{2})?$/.test(existing)) {
        log('两步验证输入框已有有效验证码，停止自动填充')
        totpFilled = true
        stopTotpAutoFill()
        return 'stop'
      }
      log('两步验证输入框已有非验证码值，将覆盖填充')
      setInputValue(target, '')
    }
    if (Array.isArray(target)) {
      const joined = target.map((i) => i.value || '').join('')
      if (/^\d{6}$/.test(joined)) {
        totpFilled = true
        stopTotpAutoFill()
        return 'stop'
      }
    }

    const code = await generateTotp(site.secret)
    fillTotpTarget(target, code)
    totpFilled = true
    stopTotpAutoFill()
    log('两步验证码已填充:', site.name, code)
    return 'filled'
  } catch (error) {
    log('两步验证码填充失败:', error)
    return 'wait_input'
  } finally {
    isTotpProcessing = false
  }
}

function getHostname(value: string): string {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return (value || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim()
  }
}

async function matchTotpSite(sites: TotpSite[]): Promise<TotpSite | null> {
  const currentHost = location.hostname.toLowerCase().replace(/^www\./, '')
  const directMatches = sites.filter(
    (site) => site?.secret && [site.url, site.domain].some((value) => value && domainsMatch(currentHost, value)),
  )
  if (directMatches.length === 1) return directMatches[0]
  if (directMatches.length > 1) return null

  try {
    const [supporting, customAliases] = await Promise.all([
      fetchSupportingFromBackground(),
      loadCustomDomainAliases(),
    ])
    const index = buildDomainAliasIndex(supporting, customAliases)
    const targetSiteIds = findSiteIdsByDomain(index, currentHost)
    if (targetSiteIds.length !== 1) return null

    const matches = sites.filter((site) => {
      if (!site?.secret) return false
      const siteIds = [site.url, site.domain].flatMap((value) =>
        value ? findSiteIdsByDomain(index, getHostname(value)) : [],
      )
      return new Set(siteIds).size === 1 && siteIds[0] === targetSiteIds[0]
    })
    return matches.length === 1 ? matches[0] : null
  } catch {
    return null
  }
}

function isVisibleInput(input: HTMLInputElement): boolean {
  const style = window.getComputedStyle(input)
  const rect = input.getBoundingClientRect()
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0 &&
    !input.disabled &&
    !input.readOnly
  )
}

function getInputText(input: HTMLInputElement): string {
  const values = [
    input.name,
    input.id,
    String(input.className || ''),
    input.placeholder,
    input.getAttribute('aria-label') || '',
    input.getAttribute('data-name') || '',
    input.getAttribute('autocomplete') || '',
  ]
  if (input.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      if (label) values.push(label.textContent || '')
    } catch {
      /* 标签选择器失效时跳过关联标签，继续使用输入框自身语义。 */
    }
  }
  const wrapperLabel = input.closest('label')
  if (wrapperLabel) values.push(wrapperLabel.textContent || '')
  return values.join(' ').toLowerCase()
}

export function isTotpSemanticText(text: string): boolean {
  return /otp|totp|2fa|mfa|authenticator|google authenticator|two[-_\s]?factor|twofactor|two-step|twostep|两步|兩步|二步|双因素|雙因素|动态|動態|令牌|安全码|安全碼|一次性|验证器|驗證器/.test(
    text.toLowerCase(),
  )
}

export function isImageCaptchaSemanticText(text: string): boolean {
  const normalized = text.toLowerCase()
  if (isTotpSemanticText(normalized)) return false
  // 含简繁：验证码/驗證碼、图形/圖形、图片/圖片；两步验证语义优先于通用“验证码”。
  return /captcha|vcode|verify.?code|check.?code|imagestring|验证码|驗證碼|图形|圖形|图片|圖片/.test(
    normalized,
  )
}

function isCaptchaLikeInput(input: HTMLInputElement): boolean {
  return isImageCaptchaSemanticText(getInputText(input))
}

function isTotpText(text: string): boolean {
  return isTotpSemanticText(text)
}

function hasTotpPageContext(): boolean {
  const values = [document.title, document.body?.textContent?.slice(0, 3000) || '']
  return isTotpText(values.join(' ').toLowerCase())
}

function isSearchLikeInput(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase()
  if (type === 'search') return true
  const text = getInputText(input)
  return /search|keyword|keywords|query|\bq\b|搜索|搜素|关键字|关键词|查找|检索/.test(text)
}

function isAccountLikeInput(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase()
  if (type === 'password') return true
  const text = getInputText(input)
  return /user.?name|account|email|mail|phone|mobile|login|password|passwd|pwd|用户名|账号|账户|邮箱|手机|密码/.test(
    text,
  )
}

function looksLikeSingleCharInput(input: HTMLInputElement): boolean {
  if (input.maxLength === 1 || input.getAttribute('maxlength') === '1') return true
  if (input.inputMode === 'numeric' && input.getBoundingClientRect().width <= 96) return true
  const rect = input.getBoundingClientRect()
  return rect.width > 0 && rect.width <= 48 && rect.height > 0 && rect.height <= 64
}

function findSplitTotpInputs(): HTMLInputElement[] | null {
  const inputs = (Array.from(document.querySelectorAll('input')) as HTMLInputElement[]).filter((input) => {
    if (!isVisibleInput(input) || isCaptchaLikeInput(input)) return false
    const type = (input.type || 'text').toLowerCase()
    if (!['text', 'tel', 'number', 'password'].includes(type)) return false
    return looksLikeSingleCharInput(input)
  })
  if (inputs.length < 6) return null
  const groups = new Map<number, HTMLInputElement[]>()
  for (const input of inputs) {
    const top = Math.round(input.getBoundingClientRect().top / 10) * 10
    const group = groups.get(top) || []
    group.push(input)
    groups.set(top, group)
  }
  for (const group of groups.values()) {
    if (group.length < 6) continue
    const sorted = group
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .slice(0, 6)
    if (sorted.every((i) => i.getBoundingClientRect().width <= 96)) return sorted
  }
  return null
}

function getTotpInputCandidates(): HTMLInputElement[] {
  return (Array.from(document.querySelectorAll('input')) as HTMLInputElement[]).filter((input) => {
    if (!isVisibleInput(input)) return false
    const type = (input.type || 'text').toLowerCase()
    if (!['text', 'tel', 'number', 'password'].includes(type)) return false
    if (isCaptchaLikeInput(input) || isAccountLikeInput(input) || isSearchLikeInput(input)) return false
    return true
  })
}

function findInputAfterLastPassword(candidates: HTMLInputElement[]): HTMLInputElement | null {
  const passwords = (
    Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
  ).filter(isVisibleInput)
  const lastPassword = passwords[passwords.length - 1]
  if (!lastPassword) return null
  const passwordRect = lastPassword.getBoundingClientRect()
  return (
    candidates
      .filter((input) => input !== lastPassword)
      .filter((input) => input.getBoundingClientRect().top >= passwordRect.top)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null
  )
}

function findTotpTarget(): TotpTarget | null {
  for (const id of TOTP_INPUT_IDS) {
    const input = document.getElementById(id) as HTMLInputElement | null
    if (input?.tagName === 'INPUT' && isVisibleInput(input) && !isCaptchaLikeInput(input)) return input
  }
  for (const name of TOTP_INPUT_NAMES) {
    const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null
    if (input && isVisibleInput(input) && !isCaptchaLikeInput(input)) return input
  }

  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="totp" i]',
    'input[id*="totp" i]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="2fa" i]',
    'input[id*="2fa" i]',
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="auth" i]',
    'input[id*="auth" i]',
    'input[placeholder*="两步"]',
    'input[placeholder*="动态"]',
    'input[placeholder*="令牌"]',
    'input[placeholder*="安全码"]',
    'input[placeholder*="二步"]',
    'input[placeholder*="双因素"]',
    'input[placeholder*="Authenticator" i]',
    'input[placeholder*="Google Authenticator" i]',
    'input[placeholder*="2FA" i]',
    'input[placeholder*="OTP" i]',
  ]
  for (const selector of selectors) {
    try {
      const input = document.querySelector(selector) as HTMLInputElement | null
      if (input && isVisibleInput(input) && !isCaptchaLikeInput(input)) return input
    } catch {
      /* 单个候选选择器失效时继续检查其余 TOTP 选择器。 */
    }
  }

  const splitInputs = findSplitTotpInputs()
  if (splitInputs) return splitInputs

  const candidates = getTotpInputCandidates()
  const passwordCount = document.querySelectorAll('input[type="password"]').length
  const hasCtx = hasTotpPageContext()
  if (!loggedCandidates) {
    loggedCandidates = true
    log(
      '两步验证输入框候选:',
      candidates.map((input) => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        maxLength: input.maxLength,
        text: getInputText(input).slice(0, 120),
      })),
    )
  }

  for (const input of candidates) {
    const text = getInputText(input)
    if (isTotpText(text)) return input
    if (hasCtx && (input.maxLength === 6 || input.maxLength === 8)) return input
  }
  if (hasCtx && candidates.length === 1) {
    log('使用唯一可见文本输入框作为两步验证输入框兜底')
    return candidates[0]
  }
  if (passwordCount > 0) {
    const afterPassword = findInputAfterLastPassword(candidates)
    if (afterPassword) {
      log('使用密码框后的文本输入框作为两步验证输入框兜底')
      return afterPassword
    }
  }
  return null
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillTotpTarget(target: TotpTarget, code: string): void {
  if (Array.isArray(target)) {
    target.forEach((input, index) => {
      setInputValue(input, code[index] || '')
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: code[index] || '' }))
    })
    target[target.length - 1]?.focus()
    return
  }
  setInputValue(target, code)
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
}

function setupTotpFocusListener(): void {
  if (totpFocusListenerBound) return
  totpFocusListenerBound = true
  document.addEventListener(
    'focus',
    (event) => {
      if (totpFilled || totpStopped || isTotpProcessing) return
      // 未匹配到站点则不再响应 focus
      if (cachedMatchedSite === null) return
      const input = event.target as HTMLInputElement | null
      if (!input || input.tagName !== 'INPUT') return
      if (!isVisibleInput(input) || isCaptchaLikeInput(input) || isAccountLikeInput(input)) return
      if (isSearchLikeInput(input)) return
      const text = getInputText(input)
      if (!isTotpText(text) && (!hasTotpPageContext() || (input.maxLength !== 6 && input.maxLength !== 8))) {
        return
      }
      if (input.value && input.value.trim()) {
        // 已有值时不强制停监听，交由 process 判断是否有效 TOTP
        scheduleTotpAttempt('focus')
        return
      }
      setTimeout(() => scheduleTotpAttempt('focus'), 80)
    },
    true,
  )
}

function setupTotpUrlChangeListener(): void {
  if (totpUrlListenerBound) return
  totpUrlListenerBound = true
  let currentUrl = location.href
  const onUrlChange = () => {
    if (totpFilled) return
    setTimeout(() => resetTotpAutoFill(), 600)
  }
  // URL 观察与输入框 DOM 观察分开（URL 变化较少）
  new MutationObserver(() => {
    if (location.href === currentUrl) return
    currentUrl = location.href
    onUrlChange()
  }).observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', onUrlChange)
  window.addEventListener('hashchange', onUrlChange)
}

function setupTotpDomObserver(): void {
  if (totpObserver) return
  totpObserver = new MutationObserver((mutations) => {
    if (totpFilled || totpStopped || isTotpProcessing) return
    // 仅新增节点时触发，忽略属性抖动
    const hasAdded = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0)
    if (!hasAdded) return
    if (totpDomDebounce) clearTimeout(totpDomDebounce)
    totpDomDebounce = setTimeout(() => {
      totpDomDebounce = null
      scheduleTotpAttempt('dom')
    }, TOTP_DOM_DEBOUNCE_MS)
  })
  totpObserver.observe(document.documentElement, { childList: true, subtree: true })
}

// 图片验证码检测、识别与结果交互

// 图片侧关键词（避免单独 code/verify，易误伤 2FA DOM；中文含简繁）
const CAPTCHA_KEYWORDS = [
  'captcha', 'vcode', 'vfcode', 'authcode', '验证码', '驗證碼', 'checkcode', 'yzm',
  'capimg', 'signcaptcha', 'imgcode', 'seccode', 'validcode', 'yanzhengma',
  'validatecode', 'piccode', 'imgverify', 'codeimg', 'randcode', 'kaptcha', 'regimage',
  'verifycode', 'captchaimg', 'vcodeimg', 'securitycode', 'security code',
  'imagestring', '图形码', '圖形碼', '图片码', '圖片碼', '校验码', '校驗碼',
  '验证图片', '驗證圖片', '验证圖', '驗證圖',
]
// 输入框关键词（更严；禁止单独 code/verify 命中 2FA；中文含简繁）
const CAPTCHA_INPUT_KEYWORDS = [
  'captcha', 'vcode', 'vfcode', 'authcode', '验证码', '驗證碼', 'checkcode', 'yzm',
  'validatecode', 'validcode', 'seccode', 'imgcode', 'randcode', 'kaptcha',
  'verifycode', 'captchainput', 'vcodeinput', 'imagestring', 'txt_code',
  'security_code', '图形码', '圖形碼', '图片码', '圖片碼', '校验码', '校驗碼',
  'captcha_code', 'img_code', '验证图片', '驗證圖片',
]
const INPUT_EXCLUDE_KEYWORDS = [
  '手机', '手機', '短信', 'sms', 'phone', 'mobile', '手机验证码', '手机驗證碼',
  '手機验证码', '手機驗證碼', '短信验证码', '短信驗證碼', '手机号', '手機號',
  'email', 'mail', '邮箱', '郵箱', '邮箱验证码', '邮箱驗證碼', '郵件验证码', '郵件驗證碼',
  '邮件验证码', '邮件驗證碼', 'username', 'user',
  'account', '账号', '帳號', '用户名', '用戶名', 'otp', 'totp', 'one time', '动态码', '動態碼', '令牌',
  '2fa', 'twofa', 'two_factor', 'two factor', 'two-step', 'twostep', 'mfa',
  'authenticator', 'google authenticator', '一次性', '两步', '兩步', '二步', '双因素', '雙因素',
  '安全码', '安全碼', '验证器', '驗證器', '搜索', '搜尋', '查询', '查詢', '关键字', '關鍵字',
  'keyword', 'search', 'query',
  'otpcode', 'otp_code', 'twofactor', 'twostep', 'google_auth', 'ga_code',
]
const EXCLUDED_INPUT_TYPES = [
  'password', 'email', 'tel', 'phone', 'mobile', 'hidden', 'submit', 'button',
  'reset', 'file', 'image', 'checkbox', 'radio', 'search', 'url', 'color',
  'range', 'date', 'time', 'datetime-local', 'month', 'week',
]
const EXCLUDED_INPUT_NAMES = [
  'username', 'user', 'account', 'email', 'mail', 'phone', 'mobile', 'tel',
  'password', 'pwd', 'pass', 'name', 'realname', 'nickname', 'search',
  'query', 'q', 'keyword', 'address', 'city',
]
const EXCLUDE_IMAGE_PATTERNS = [
  'avatar', 'logo', 'icon', 'banner', 'sponsor', 'background',
  'profile', 'user', 'photo', 'emoji', 'emoticon', 'sticker', 'gif',
  'loading', 'spinner', 'placeholder', 'sprite', 'badge', 'smiley', 'favicon',
  'slider', 'slide', 'drag', 'puzzle', 'jigsaw',
]
// 站点卡 / MP 站点管理 UI 等非验证码容器（祖先 id/class 命中则排除）
const EXCLUDE_IMAGE_ANCESTOR_PATTERNS = [
  'item-card',
  'item_card',
  'itemcard',
  'site-card',
  'site_card',
  'site-icon',
  'site_icon',
  'siteicon',
  'mp_site_',
  'mp-site-',
  'sm-icon',
  'sm_icon',
  'sitecard',
  'site-manage',
  'sitemanage',
  'site-list',
  'sitelist',
  'v-card',
]
const MIN_CAPTCHA_WIDTH = 50
const MIN_CAPTCHA_HEIGHT = 20
const MAX_CAPTCHA_WIDTH = 400
const MAX_CAPTCHA_HEIGHT = 150
// 最低置信度门槛（仅「关联输入 + 尺寸」约 35，需关键词/明确 captcha 输入等信号）
const MIN_CAPTCHA_CONFIDENCE = 50
// 同一候选连续识别失败上限，防止 observer 死循环刷日志/Toast
const MAX_CAPTCHA_FAILS_PER_KEY = 2

interface DetectedCaptcha {
  image: HTMLImageElement
  input: HTMLInputElement
  confidence: number
  imageSrc: string
}

let captchaFilled = false
let captchaProcessing = false
let captchaOfflinePreferred = false
let captchaObserver: MutationObserver | null = null
let captchaDebounce: ReturnType<typeof setTimeout> | null = null
let captchaImageLoadListenerBound = false
let lastCaptchaImageSrc = ''
let lastCaptchaInputSelector = ''
// 扩展重载/卸载后停止，避免 Extension context invalidated 刷屏
let captchaStopped = false
// 候选失败指纹 → 次数（勿用完整 data: URL 当 key）
const captchaFailCounts = new Map<string, number>()

function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id
  } catch {
    return false
  }
}

function stopCaptchaAutoFill(reason: string): void {
  captchaStopped = true
  captchaProcessing = false
  if (captchaDebounce) {
    clearTimeout(captchaDebounce)
    captchaDebounce = null
  }
  if (captchaObserver) {
    try {
      captchaObserver.disconnect()
    } catch {
      /* Observer 所属页面上下文已销毁时无需重复断开。 */
    }
    captchaObserver = null
  }
  try {
    log('已停止图片验证码自动识别', reason)
  } catch {
    /* 扩展失效时 console 仍可用 */
  }
}

function isExtensionContextError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '')
  return /extension context invalidated|receiving end does not exist|message port closed|context invalidated/i.test(
    msg,
  )
}

// 失败计数 key：优先 DOM 指纹，避免 data: 超长 base64
function captchaCandidateKey(image: HTMLImageElement, imageSrc: string, input?: HTMLInputElement | null): string {
  try {
    const imgSel = getElementSelector(image)
    const inSel = input ? getElementSelector(input) : ''
    return `${imgSel}::${inSel}`
  } catch {
    if (imageSrc.startsWith('data:')) return `data:${imageSrc.slice(0, 48)}`
    return imageSrc.slice(0, 120)
  }
}

function startCaptchaAutoFill(offlinePreferred: boolean): void {
  captchaOfflinePreferred = offlinePreferred
  captchaStopped = false
  log('启动图片验证码自动识别', { offlinePreferred })
  const run = () => {
    void processCaptcha()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 400), { once: true })
  } else {
    setTimeout(run, 400)
  }
  setupCaptchaObserver()
  setupCaptchaImageLoadListener()
}

function setupCaptchaImageLoadListener(): void {
  if (captchaImageLoadListenerBound) return
  captchaImageLoadListenerBound = true
  document.addEventListener(
    'load',
    (event) => {
      if (captchaStopped || captchaFilled || captchaProcessing) return
      const image = event.target
      if (!(image instanceof HTMLImageElement)) return
      if (!elementMatchesCaptchaKeywords(image) && !srcContainsCaptchaKeywords(image)) return
      setTimeout(() => void processCaptcha(), 0)
    },
    true,
  )
}

function setupCaptchaObserver(): void {
  if (captchaObserver || captchaStopped) return
  captchaObserver = new MutationObserver((mutations) => {
    if (captchaStopped || !isExtensionContextValid()) {
      stopCaptchaAutoFill('extension context invalid')
      return
    }
    // 忽略自身 Toast / 纠错弹层引起的 DOM 抖动
    const isSelfUi = (n: Node) =>
      n instanceof HTMLElement &&
      (n.id === 'mp-captcha-toast-host' ||
        n.id === 'mp-captcha-correct-host' ||
        n.id === 'mp-captcha-toast' ||
        n.id === 'mp-captcha-correct' ||
        !!n.closest?.(
          '#mp-captcha-toast-host, #mp-captcha-correct-host, #mp-captcha-toast, #mp-captcha-correct',
        ))
    if (
      mutations.some(
        (m) =>
          Array.from(m.addedNodes).some(isSelfUi) || Array.from(m.removedNodes).some(isSelfUi),
      )
    ) {
      return
    }
    resetCaptchaFilledIfTargetGone()
    if (captchaFilled || captchaProcessing) return
    if (captchaDebounce) clearTimeout(captchaDebounce)
    captchaDebounce = setTimeout(() => {
      captchaDebounce = null
      void processCaptcha()
    }, 300)
  })
  captchaObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'style'],
  })
}

function includesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((k) => lower.includes(k.toLowerCase()))
}

function isVisibleElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0
}

function isCaptchaSize(width: number, height: number): boolean {
  return width >= MIN_CAPTCHA_WIDTH && width <= MAX_CAPTCHA_WIDTH && height >= MIN_CAPTCHA_HEIGHT && height <= MAX_CAPTCHA_HEIGHT
}

function getEffectiveImageSize(image: HTMLImageElement): { width: number; height: number } {
  const rect = image.getBoundingClientRect()
  const width = rect.width || image.naturalWidth || parseInt(image.getAttribute('width') || '0') || 0
  const height = rect.height || image.naturalHeight || parseInt(image.getAttribute('height') || '0') || 0
  return { width, height }
}

function getImageSrcForCheck(image: HTMLImageElement): string {
  const src = (image.currentSrc || image.src || image.getAttribute('data-src') || '').trim()
  if (!src || src.startsWith('data:image/') || src.startsWith('blob:')) return ''
  try {
    const url = new URL(src, window.location.href)
    return `${url.origin}${url.pathname}`.toLowerCase()
  } catch {
    return src.slice(0, 200).toLowerCase()
  }
}

function elementIdentityBag(el: Element): string {
  const he = el as HTMLElement
  const cls =
    typeof he.className === 'string'
      ? he.className
      : ((he.className as { baseVal?: string } | undefined)?.baseVal ??
        he.getAttribute?.('class') ??
        '')
  return `${he.id || ''} ${cls} ${he.getAttribute?.('data-id') || ''} ${he.tagName || ''}`.toLowerCase()
}

function hasShortImageExcludeToken(element: Element): boolean {
  const id = ((element as HTMLElement).id || '').trim().toLowerCase()
  const classNames = (
    typeof (element as HTMLElement).className === 'string'
      ? (element as HTMLElement).className
      : element.getAttribute('class') || ''
  )
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return ['ad', 'ads', 'bg'].includes(id) || classNames.some((name) => ['ad', 'ads', 'bg'].includes(name))
}

function isExcludedImage(image: HTMLImageElement): boolean {
  const combined = [
    getImageSrcForCheck(image),
    image.alt,
    image.title,
    elementIdentityBag(image),
  ]
    .join(' ')
    .toLowerCase()
  if (includesAny(combined, EXCLUDE_IMAGE_PATTERNS) || hasShortImageExcludeToken(image)) return true
  // 自身 id 也可能是 item-card-name-mp_site_xxx
  if (includesAny(combined, EXCLUDE_IMAGE_ANCESTOR_PATTERNS)) return true
  // 祖先容器：站点卡 / MP 站点列表等
  let parent: HTMLElement | null = image.parentElement
  let depth = 0
  while (parent && depth < 14) {
    const bag = elementIdentityBag(parent)
    if (includesAny(bag, EXCLUDE_IMAGE_ANCESTOR_PATTERNS)) return true
    if (includesAny(bag, EXCLUDE_IMAGE_PATTERNS) || hasShortImageExcludeToken(parent)) return true
    if (/item[-_]?card|mp_site_|mp-site-|site[-_]?card|site[-_]?icon/i.test(bag)) return true
    parent = parent.parentElement
    depth++
  }
  return false
}

// 超大方形图（站点图标 256/512 等）不像图形验证码
function isUnlikelyCaptchaGeometry(image: HTMLImageElement): boolean {
  const nw = image.naturalWidth || 0
  const nh = image.naturalHeight || 0
  if (nw >= 200 && nh >= 200) {
    const ratio = nw / nh
    if (ratio > 0.75 && ratio < 1.35) return true
  }
  const { width, height } = getEffectiveImageSize(image)
  if (width >= 180 && height >= 180) {
    const ratio = width / height
    if (ratio > 0.8 && ratio < 1.25) return true
  }
  return false
}

function elementMatchesCaptchaKeywords(element: Element): boolean {
  const text = [
    (element as HTMLElement).id || '',
    (element as HTMLElement).className?.toString?.() || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('data-name') || '',
    element.getAttribute('data-type') || '',
    element.getAttribute('alt') || '',
    element.getAttribute('title') || '',
  ].join(' ')
  return includesAny(text, CAPTCHA_KEYWORDS)
}

function srcContainsCaptchaKeywords(image: HTMLImageElement): boolean {
  // data:/blob: base64 会随机命中 seccode 等子串，禁止参与关键词打分
  const parts = [image.currentSrc || '', image.src || '', image.getAttribute('data-src') || '']
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('data:') && !s.startsWith('blob:'))
  if (!parts.length) return false
  return includesAny(parts.join(' '), CAPTCHA_KEYWORDS)
}

function parentContainsCaptchaKeywords(element: Element): boolean {
  let parent = element.parentElement
  let depth = 0
  while (parent && depth < 3) {
    if (elementMatchesCaptchaKeywords(parent)) return true
    const text = parent.textContent?.trim() || ''
    if (text.length <= 240 && includesAny(text, CAPTCHA_KEYWORDS)) return true
    parent = parent.parentElement
    depth++
  }
  return false
}

function getInputLabelText(input: HTMLInputElement): string {
  try {
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      if (label) return label.textContent || ''
    }
    const wrapperLabel = input.closest('label')
    if (wrapperLabel) return wrapperLabel.textContent || ''
  } catch {
    /* 选择器转义或宿主 DOM 查询失败时按无标签处理，继续使用其他输入特征评分。 */
  }
  return ''
}

function getInputSearchText(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.className,
    input.placeholder,
    input.getAttribute('aria-label') || '',
    input.getAttribute('data-label') || '',
    input.getAttribute('data-name') || '',
    getInputLabelText(input),
  ]
    .join(' ')
    .toLowerCase()
}

// 图片验证码输入框：需更具体 captcha 语义，且绝不能是 2FA
function isCaptchaInputByName(input: HTMLInputElement): boolean {
  if (isTotpTargetInput(input)) return false
  const text = getInputSearchText(input)
  // 优先复用 TOTP 侧 isCaptchaLikeInput（更严）
  if (isCaptchaLikeInput(input)) return true
  return CAPTCHA_INPUT_KEYWORDS.some((k) => text.includes(k.toLowerCase()))
}

// 是否像两步验证输入框（复用 TOTP 规则并加强）；永不作为图片验证码目标
function isTotpTargetInput(input: HTMLInputElement): boolean {
  const name = (input.name || '').toLowerCase()
  const id = (input.id || '').toLowerCase()
  const text = getInputSearchText(input)

  // 明确 TOTP 语义：文案含「验证码」也优先判为 2FA
  if (isTotpText(text)) return true
  if (TOTP_INPUT_IDS.some((v) => v.toLowerCase() === id)) return true
  if (TOTP_INPUT_NAMES.some((v) => v.toLowerCase() === name)) return true

  // 6/8 位短数字框 + 页面/近邻有 2FA 语境
  const maxLen = input.maxLength
  const shortNumeric =
    (maxLen === 6 || maxLen === 8) &&
    /number|numeric|tel|text/i.test(`${input.type} ${input.inputMode || ''}`)
  if (shortNumeric && !isCaptchaLikeInput(input)) {
    if (hasTotpPageContext()) return true
    // 邻近 label/placeholder 的「动态/令牌/两步」已由 isTotpText 覆盖
  }

  // 分格 2FA 单字符框
  if (looksLikeSingleCharInput(input) && !isCaptchaLikeInput(input)) {
    if (hasTotpPageContext() || isTotpText(text)) return true
  }

  return false
}

function isExcludedCaptchaInput(input: HTMLInputElement): boolean {
  if (isTotpTargetInput(input)) return true
  const text = getInputSearchText(input)
  return (
    includesAny(text, INPUT_EXCLUDE_KEYWORDS) ||
    includesAny(text, ['username', 'account', 'search', 'query', 'keyword']) ||
    isAccountLikeInput(input) ||
    isSearchLikeInput(input)
  )
}

function isValidCaptchaInput(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase()
  if (EXCLUDED_INPUT_TYPES.includes(type)) return false
  if (isTotpTargetInput(input)) return false
  const name = (input.name || '').toLowerCase()
  const id = (input.id || '').toLowerCase()
  if (EXCLUDED_INPUT_NAMES.some((ex) => name === ex || id === ex)) return false
  if (!isVisibleElement(input)) return false
  const rect = input.getBoundingClientRect()
  if (rect.width > 420) return false
  return true
}

function getElementDistanceByRect(a: DOMRect, b: DOMRect): number {
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  const bx = b.left + b.width / 2
  const by = b.top + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

// 分数越小越优；2FA 直接淘汰
function scoreInputCandidate(input: HTMLInputElement, captchaRect: DOMRect): number {
  if (isTotpTargetInput(input) || isExcludedCaptchaInput(input)) return Number.POSITIVE_INFINITY
  const inputRect = input.getBoundingClientRect()
  const distance = getElementDistanceByRect(captchaRect, inputRect)
  const text = getInputSearchText(input)
  let bonus = 0
  if (isCaptchaInputByName(input)) bonus += 160
  // 简繁：验证码/驗證碼 等同加权
  if ((text.includes('验证码') || text.includes('驗證碼')) && !isTotpText(text)) bonus += 140
  if (
    text.includes('图形') || text.includes('圖形')
    || text.includes('图片码') || text.includes('圖片碼')
    || text.includes('校验码') || text.includes('校驗碼')
    || text.includes('验证图片') || text.includes('驗證圖片')
  ) bonus += 100
  if (text.includes('vcode') || text.includes('vfcode') || text.includes('captcha')) bonus += 100
  if (text.includes('authcode') || text.includes('checkcode') || text.includes('yzm')) bonus += 80
  return distance - bonus
}

function findClosestInputInContainer(
  container: Element,
  captchaRect: DOMRect,
  maxDistance = Infinity,
): HTMLInputElement | null {
  const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[]
  let best: HTMLInputElement | null = null
  let bestScore = Infinity
  let bestDistance = Infinity
  for (const input of inputs) {
    if (!isValidCaptchaInput(input)) continue
    if (isExcludedCaptchaInput(input)) continue
    const inputRect = input.getBoundingClientRect()
    const distance = getElementDistanceByRect(captchaRect, inputRect)
    if (distance > maxDistance) continue
    const score = scoreInputCandidate(input, captchaRect)
    if (!Number.isFinite(score)) continue
    if (score < bestScore || (Math.abs(score - bestScore) < 15 && distance < bestDistance)) {
      bestScore = score
      bestDistance = distance
      best = input
    }
  }
  return best
}

function findFrameworkRelatedInput(element: Element): HTMLInputElement | null {
  const containers = [
    element.closest('.el-input, .el-input-group, .el-form-item'),
    element.closest('.ant-input-group, .ant-form-item, .ant-input-affix-wrapper'),
    element.closest('.ivu-input-group, .ivu-form-item'),
    element.closest('.van-field, .van-cell'),
  ].filter(Boolean) as Element[]
  for (const container of containers) {
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[]
    for (const input of inputs) {
      if (!isValidCaptchaInput(input) || isExcludedCaptchaInput(input)) continue
      if (isCaptchaInputByName(input) || !isTotpTargetInput(input)) return input
    }
  }
  return null
}

function findRelatedCaptchaInput(element: Element): HTMLInputElement | null {
  const captchaRect = element.getBoundingClientRect()

  // 1) 优先：明确 captcha 语义
  {
    let bestNamed: HTMLInputElement | null = null
    let bestNamedScore = Infinity
    for (const input of Array.from(document.querySelectorAll('input')) as HTMLInputElement[]) {
      if (!isValidCaptchaInput(input) || isExcludedCaptchaInput(input)) continue
      if (!isCaptchaInputByName(input)) continue
      const score = scoreInputCandidate(input, captchaRect)
      if (score < bestNamedScore) {
        bestNamedScore = score
        bestNamed = input
      }
    }
    if (bestNamed && bestNamedScore < 360) return bestNamed
  }

  // 2) 框架 / 父子容器
  const frameworkInput = findFrameworkRelatedInput(element)
  if (frameworkInput && !isTotpTargetInput(frameworkInput)) return frameworkInput

  const parent = element.parentElement
  if (parent) {
    const input = findClosestInputInContainer(parent, captchaRect)
    if (input && !isTotpTargetInput(input)) return input
  }

  let ancestor = parent?.parentElement
  let depth = 0
  while (ancestor && depth < 4) {
    const input = findClosestInputInContainer(ancestor, captchaRect, 180)
    if (input && !isTotpTargetInput(input)) return input
    ancestor = ancestor.parentElement
    depth++
  }

  // 3) 邻近兜底
  let best: HTMLInputElement | null = null
  let bestScore = Infinity
  for (const input of Array.from(document.querySelectorAll('input')) as HTMLInputElement[]) {
    if (!isValidCaptchaInput(input)) continue
    if (isExcludedCaptchaInput(input) || isTotpTargetInput(input)) continue
    const inputRect = input.getBoundingClientRect()
    const roughlyNear =
      (inputRect.left > captchaRect.right &&
        inputRect.left - captchaRect.right < 220 &&
        Math.abs(inputRect.top - captchaRect.top) < 90) ||
      (inputRect.top > captchaRect.bottom &&
        inputRect.top - captchaRect.bottom < 160 &&
        Math.abs(inputRect.left - captchaRect.left) < 160) ||
      getElementDistanceByRect(captchaRect, inputRect) < 200
    if (!roughlyNear) continue
    if (!isCaptchaInputByName(input) && getElementDistanceByRect(captchaRect, inputRect) > 120) {
      continue
    }
    const score = scoreInputCandidate(input, captchaRect)
    if (score < bestScore) {
      bestScore = score
      best = input
    }
  }
  return best && !isTotpTargetInput(best) ? best : null
}

function calculateCaptchaConfidence(image: HTMLImageElement): number {
  let score = 0
  if (elementMatchesCaptchaKeywords(image)) score += 30
  if (srcContainsCaptchaKeywords(image)) score += 20
  if (parentContainsCaptchaKeywords(image)) score += 15
  const related = findRelatedCaptchaInput(image)
  if (related) score += 25
  if (related && isCaptchaInputByName(related)) score += 20
  const { width, height } = getEffectiveImageSize(image)
  if (isCaptchaSize(width, height)) score += 10
  return Math.min(score, 100)
}

// 根据尺寸、属性和上下文判断图片是否可能为验证码。
function isLikelyCaptchaImage(image: HTMLImageElement): boolean {
  const { width, height } = getEffectiveImageSize(image)
  if (!isCaptchaSize(width, height)) return false
  if (!isVisibleElement(image)) return false
  if (isExcludedImage(image)) return false
  if (isUnlikelyCaptchaGeometry(image)) return false
  if (elementMatchesCaptchaKeywords(image)) return true
  if (srcContainsCaptchaKeywords(image)) return true
  if (parentContainsCaptchaKeywords(image)) return true
  const input = findRelatedCaptchaInput(image)
  if (input && isCaptchaInputByName(input)) return true
  return false
}

function getCaptchaImageSrc(image: HTMLImageElement): string {
  return (
    image.currentSrc ||
    image.src ||
    image.getAttribute('data-src') ||
    image.style.backgroundImage?.match(/url\(["']?([^"')]+)["']?\)/)?.[1] ||
    ''
  )
}

function getElementSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`
  const name = element.getAttribute('name')
  if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
  const parent = element.parentElement
  if (!parent) return element.tagName.toLowerCase()
  const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName)
  const index = sameTag.indexOf(element) + 1
  return `${getElementSelector(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`
}

function detectCaptchaElements(): DetectedCaptcha | null {
  const candidates = (Array.from(document.querySelectorAll('img')) as HTMLImageElement[])
    .filter(isLikelyCaptchaImage)
    .map((image) => ({
      image,
      input: findRelatedCaptchaInput(image),
      confidence: calculateCaptchaConfidence(image),
      imageSrc: getCaptchaImageSrc(image),
    }))
    .filter((item): item is DetectedCaptcha => {
      if (!item.input || !item.imageSrc) return false
      if (isTotpTargetInput(item.input) || isExcludedCaptchaInput(item.input)) return false
      if (isExcludedImage(item.image) || isUnlikelyCaptchaGeometry(item.image)) return false
      if (item.confidence < MIN_CAPTCHA_CONFIDENCE) return false
      const semantic =
        elementMatchesCaptchaKeywords(item.image) ||
        srcContainsCaptchaKeywords(item.image) ||
        parentContainsCaptchaKeywords(item.image) ||
        isCaptchaInputByName(item.input)
      if (!semantic) return false
      const key = captchaCandidateKey(item.image, item.imageSrc, item.input)
      if ((captchaFailCounts.get(key) || 0) >= MAX_CAPTCHA_FAILS_PER_KEY) return false
      return true
    })
    .sort((a, b) => b.confidence - a.confidence)

  const best = candidates[0] || null
  if (best) {
    log('找到验证码候选', {
      image: getElementSelector(best.image),
      input: getElementSelector(best.input),
      confidence: best.confidence,
    })
  }
  return best
}

function removeCaptchaUi(
  ids: string[] = ['mp-captcha-toast-host', 'mp-captcha-correct-host', 'mp-captcha-toast', 'mp-captcha-correct'],
): void {
  for (const id of ids) document.getElementById(id)?.remove()
}

// 验证码提示与纠错界面
type CaptchaToastAction = { label: string; onClick: () => void }

interface CaptchaToastOptions {
  title: string
  message?: string
  type?: 'success' | 'error'
  code?: string
  raw?: string
  source?: string
  actions?: CaptchaToastAction[]
  durationMs?: number
}

function getBrandLogoUrl(): string {
  try {
    return chrome.runtime.getURL('icons/icon-32.png')
  } catch {
    return ''
  }
}

async function isCaptchaDarkMode(): Promise<boolean> {
  try {
    const mode = (await getPublicStore()).ui?.theme
    if (mode === 'dark') return true
    if (mode === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function showCaptchaToast(
  title: string,
  message?: string,
  type: 'success' | 'error' = 'success',
  actions?: CaptchaToastAction[],
): void {
  void showCaptchaToastEx({ title, message, type, actions })
}

// 识别提示使用 Shadow 卡片，支持右侧滑入、主题颜色和结果操作。
async function showCaptchaToastEx(opts: CaptchaToastOptions): Promise<void> {
  const type = opts.type ?? 'success'
  const isSuccess = type === 'success'
  const code = (opts.code || '').trim()
  const raw = (opts.raw || '').trim()
  const sourceText = (opts.source || '').trim()
  const durationMs = opts.durationMs ?? (opts.actions?.length ? 10000 : 4500)
  const dark = await isCaptchaDarkMode()

  removeCaptchaUi()

  // 按内容自适应宽度，避免固定 320 过宽/过窄
  const hasMeta = !!(code && ((raw && raw !== code) || sourceText))
  const hasAction = !!opts.actions?.length
  const hostWidth = code
    ? hasMeta || hasAction
      ? 300
      : 260
    : 280

  const host = document.createElement('div')
  host.id = 'mp-captcha-toast-host'
  host.style.cssText =
    `position:fixed!important;top:20px!important;right:-${hostWidth + 40}px!important;width:min(${hostWidth}px, calc(100vw - 24px))!important;z-index:99999999!important;transition:right .4s cubic-bezier(.175,.885,.32,1.275)!important;pointer-events:none!important;`
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })
  const autoDismissTimer = window.setTimeout(() => dismiss(), durationMs)

  const card = document.createElement('div')
  card.style.cssText = [
    `background:${dark ? 'rgba(30,41,59,.98)' : 'rgba(255,255,255,.98)'}!important`,
    'backdrop-filter:blur(10px)!important',
    '-webkit-backdrop-filter:blur(10px)!important',
    'box-shadow:0 10px 25px rgba(0,0,0,.12)!important',
    `border:1px solid ${dark ? 'rgba(71,85,105,.6)' : 'rgba(226,232,240,.9)'}!important`,
    'border-radius:12px!important',
    'padding:10px 12px!important',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif!important',
    'width:100%!important',
    'position:relative!important',
    'box-sizing:border-box!important',
    'pointer-events:auto!important',
  ].join(';')

  const dismiss = () => {
    if (autoDismissTimer) window.clearTimeout(autoDismissTimer)
    host.style.setProperty('right', `-${hostWidth + 40}px`, 'important')
    window.setTimeout(() => host.remove(), 400)
  }

  // 右侧操作列放置关闭和纠正按钮，使用与卡片内容区连续的内边距。
  const rightColW = hasAction ? 40 : 20
  const padX = 12
  const padY = 10
  const rightCol = document.createElement('div')
  rightCol.style.cssText = [
    'position:absolute!important',
    `top:${padY}px!important`,
    `right:${padX}px!important`,
    `width:${rightColW}px!important`,
    `bottom:${padY}px!important`,
    'display:flex!important',
    'flex-direction:column!important',
    'align-items:flex-end!important',
    'justify-content:flex-start!important',
    'z-index:2!important',
    'pointer-events:none!important',
  ].join(';')

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.innerHTML = '&times;'
  closeBtn.style.cssText = [
    'pointer-events:auto!important',
    'flex:0 0 auto!important',
    'width:20px!important',
    'height:20px!important',
    'border:none!important',
    'background:transparent!important',
    'color:#94a3b8!important',
    'font-size:16px!important',
    'cursor:pointer!important',
    'padding:0!important',
    'line-height:20px!important',
    'text-align:right!important',
  ].join(';')
  closeBtn.onclick = () => dismiss()
  rightCol.appendChild(closeBtn)

  // 主体：左 logo | 中文字上下贴边；第二行底边与纠正按钮同高
  const body = document.createElement('div')
  body.style.cssText = [
    'display:flex!important',
    'align-items:stretch!important',
    'gap:10px!important',
    `padding-right:${rightColW + 4}px!important`,
    'min-width:0!important',
  ].join(';')

  const logoBox = document.createElement('div')
  logoBox.style.cssText = [
    'width:40px!important',
    'align-self:stretch!important',
    'min-height:40px!important',
    'border-radius:10px!important',
    'flex:0 0 auto!important',
    'display:flex!important',
    'align-items:center!important',
    'justify-content:center!important',
    `background:${dark ? 'rgba(51,65,85,.9)' : 'rgba(248,250,252,1)'}!important`,
    `border:1px solid ${dark ? 'rgba(71,85,105,.7)' : 'rgba(226,232,240,.95)'}!important`,
    'overflow:hidden!important',
  ].join(';')
  const logoUrl = getBrandLogoUrl()
  if (logoUrl) {
    const img = document.createElement('img')
    img.src = logoUrl
    img.alt = ''
    img.width = 24
    img.height = 24
    img.style.cssText =
      'width:24px!important;height:24px!important;object-fit:contain!important;display:block!important;'
    img.onerror = () => {
      img.remove()
      logoBox.textContent = 'MP'
      logoBox.style.cssText +=
        'font-size:11px!important;font-weight:800!important;color:#1677ff!important;'
    }
    logoBox.appendChild(img)
  } else {
    logoBox.textContent = 'MP'
    logoBox.style.cssText +=
      'font-size:11px!important;font-weight:800!important;color:#1677ff!important;'
  }
  body.appendChild(logoBox)

  const textCol = document.createElement('div')
  textCol.style.cssText =
    'flex:1 1 auto!important;min-width:0!important;display:flex!important;flex-direction:column!important;justify-content:space-between!important;gap:4px!important;align-self:stretch!important;'

  // 第 1 行：品牌 + 状态
  const line1 = document.createElement('div')
  line1.style.cssText =
    'display:flex!important;align-items:center!important;gap:8px!important;min-width:0!important;min-height:20px!important;line-height:1.25!important;'

  const brand = document.createElement('span')
  brand.textContent = 'MoviePilot Tools'
  brand.style.cssText = `font-size:12px!important;font-weight:700!important;color:${dark ? '#f1f5f9' : '#0f172a'}!important;line-height:1.25!important;flex:0 0 auto!important;white-space:nowrap!important;`
  line1.appendChild(brand)

  const status = document.createElement('span')
  status.textContent = code
    ? opts.title || '验证码已填充'
    : opts.title || (isSuccess ? '提示' : '识别失败')
  status.style.cssText = [
    'min-width:0!important',
    'flex:1 1 auto!important',
    'font-size:12px!important',
    'font-weight:600!important',
    'line-height:1.25!important',
    `color:${isSuccess ? (dark ? '#86efac' : '#16a34a') : dark ? '#fca5a5' : '#dc2626'}!important`,
    'white-space:nowrap!important',
    'overflow:hidden!important',
    'text-overflow:ellipsis!important',
  ].join(';')
  line1.appendChild(status)
  textCol.appendChild(line1)

  // 第 2 行：来源/识别码；高度 20 与纠正按钮齐平
  const line2 = document.createElement('div')
  line2.style.cssText =
    'display:flex!important;align-items:center!important;gap:6px!important;width:100%!important;min-width:0!important;height:20px!important;line-height:20px!important;overflow:hidden!important;'

  if (code) {
    if (sourceText) {
      const sourceEl = document.createElement('span')
      sourceEl.textContent = sourceText
      sourceEl.style.cssText = [
        'flex:0 0 auto!important',
        'font-size:12px!important',
        'font-weight:700!important',
        `color:${dark ? '#f1f5f9' : '#0f172a'}!important`,
        'line-height:1.25!important',
        'white-space:nowrap!important',
      ].join(';')
      line2.appendChild(sourceEl)
    }

    const codeTag = document.createElement('span')
    codeTag.textContent = code
    codeTag.style.cssText = [
      'display:inline-flex!important',
      'align-items:center!important',
      'flex:0 1 auto!important',
      'min-width:0!important',
      'max-width:100%!important',
      'box-sizing:border-box!important',
      'height:20px!important',
      'padding:0 6px!important',
      'border-radius:6px!important',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important',
      'font-size:11px!important',
      'font-weight:700!important',
      'letter-spacing:.06em!important',
      'line-height:1!important',
      `color:${isSuccess ? (dark ? '#86efac' : '#14532d') : dark ? '#fca5a5' : '#7f1d1d'}!important`,
      `background:${
        isSuccess
          ? dark
            ? 'rgba(22,163,74,.18)'
            : 'rgba(22,163,74,.1)'
          : dark
            ? 'rgba(220,38,38,.18)'
            : 'rgba(220,38,38,.1)'
      }!important`,
      `box-shadow:inset 0 0 0 1px ${
        isSuccess
          ? dark
            ? 'rgba(74,222,128,.35)'
            : 'rgba(22,163,74,.28)'
          : dark
            ? 'rgba(248,113,113,.35)'
            : 'rgba(220,38,38,.28)'
      }!important`,
      'overflow:hidden!important',
      'text-overflow:ellipsis!important',
      'white-space:nowrap!important',
    ].join(';')
    line2.appendChild(codeTag)

    if (raw && raw !== code) {
      const meta = document.createElement('span')
      meta.textContent = `原文 ${raw}`
      meta.style.cssText = [
        'min-width:0!important',
        'flex:1 1 auto!important',
        'font-size:11px!important',
        'font-weight:500!important',
        'line-height:1.25!important',
        `color:${dark ? '#94a3b8' : '#64748b'}!important`,
        'white-space:nowrap!important',
        'overflow:hidden!important',
        'text-overflow:ellipsis!important',
      ].join(';')
      line2.appendChild(meta)
    }
  } else {
    const msg = document.createElement('span')
    msg.textContent = (opts.message || '').trim() || (isSuccess ? '操作完成' : '请重试')
    msg.style.cssText = [
      'min-width:0!important',
      'flex:1 1 auto!important',
      'font-size:11px!important',
      'line-height:1.25!important',
      `color:${dark ? '#94a3b8' : '#64748b'}!important`,
      'white-space:nowrap!important',
      'overflow:hidden!important',
      'text-overflow:ellipsis!important',
    ].join(';')
    line2.appendChild(msg)
  }

  textCol.appendChild(line2)
  body.appendChild(textCol)

  if (opts.actions?.length) {
    const act = opts.actions[0]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = act.label
    btn.style.cssText = [
      'pointer-events:auto!important',
      'flex:0 0 auto!important',
      'width:100%!important',
      'box-sizing:border-box!important',
      'height:20px!important',
      'margin-top:auto!important',
      'margin-bottom:0!important',
      'padding:0!important',
      `border:1px solid ${dark ? 'rgba(148,163,184,.3)' : '#e2e8f0'}!important`,
      'background:transparent!important',
      `color:${dark ? '#cbd5e1' : '#475569'}!important`,
      'border-radius:6px!important',
      'font-size:11px!important',
      'cursor:pointer!important',
      'font-weight:600!important',
      'white-space:nowrap!important',
      'line-height:18px!important',
      'text-align:center!important',
    ].join(';')
    btn.onclick = () => {
      act.onClick()
    }
    rightCol.appendChild(btn)
  }

  card.appendChild(body)
  card.appendChild(rightCol)
  shadow.appendChild(card)
  window.setTimeout(() => {
    host.style.setProperty('right', '20px', 'important')
  }, 50)

}

// 就地纠正弹层使用独立 Shadow 卡片，避免污染宿主页面样式。
async function openCaptchaCorrectDialog(opts: {
  raw: string
  filled: string
  input: HTMLInputElement
  sourceLabel: string
}): Promise<void> {
  removeCaptchaUi()
  const dark = await isCaptchaDarkMode()

  const host = document.createElement('div')
  host.id = 'mp-captcha-correct-host'
  const correctWidth = 300
  host.style.cssText =
    `position:fixed!important;top:20px!important;right:-${correctWidth + 40}px!important;width:min(${correctWidth}px, calc(100vw - 24px))!important;z-index:99999999!important;transition:right .4s cubic-bezier(.175,.885,.32,1.275)!important;pointer-events:none!important;`
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'closed' })

  const dismiss = () => {
    host.style.setProperty('right', `-${correctWidth + 40}px`, 'important')
    window.setTimeout(() => host.remove(), 400)
  }

  const card = document.createElement('div')
  card.style.cssText = [
    `background:${dark ? 'rgba(30,41,59,.98)' : 'rgba(255,255,255,.98)'}!important`,
    'backdrop-filter:blur(10px)!important',
    'box-shadow:0 10px 25px rgba(0,0,0,.12)!important',
    `border:1px solid ${dark ? 'rgba(71,85,105,.6)' : 'rgba(226,232,240,.9)'}!important`,
    'border-radius:12px!important',
    'padding:10px 12px!important',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif!important',
    'width:100%!important',
    'position:relative!important',
    'box-sizing:border-box!important',
    'pointer-events:auto!important',
  ].join(';')

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.innerHTML = '&times;'
  closeBtn.style.cssText =
    'position:absolute!important;top:6px!important;right:8px!important;width:20px!important;height:20px!important;border:none!important;background:transparent!important;color:#94a3b8!important;font-size:16px!important;cursor:pointer!important;padding:0!important;line-height:20px!important;'
  closeBtn.onclick = () => dismiss()
  card.appendChild(closeBtn)

  const title = document.createElement('div')
  title.textContent = 'MoviePilot Tools'
  title.style.cssText = `font-size:12px!important;font-weight:700!important;color:${dark ? '#f1f5f9' : '#0f172a'}!important;padding-right:18px!important;`
  card.appendChild(title)

  const desc = document.createElement('div')
  desc.textContent = `纠正验证码识别（${opts.sourceLabel}），将保存「识别 → 正确」映射`
  desc.style.cssText = `font-size:11px!important;color:${dark ? '#94a3b8' : '#64748b'}!important;margin-top:4px!important;line-height:1.4!important;padding-right:8px!important;`
  card.appendChild(desc)

  const fieldCss = (readonly: boolean) =>
    [
      'width:100%!important',
      'box-sizing:border-box!important',
      `border:1px solid ${dark ? 'rgba(71,85,105,.8)' : '#e2e8f0'}!important`,
      'border-radius:8px!important',
      'padding:7px 9px!important',
      'font-size:12px!important',
      `background:${readonly ? (dark ? 'rgba(15,23,42,.55)' : '#f8fafc') : dark ? 'rgba(15,23,42,.35)' : '#fff'}!important`,
      `color:${dark ? '#e2e8f0' : '#0f172a'}!important`,
      'outline:none!important',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important',
    ].join(';')

  const mkField = (label: string, value: string, readonly: boolean) => {
    const wrap = document.createElement('label')
    wrap.style.cssText = 'display:block!important;margin-top:10px!important;'
    const lab = document.createElement('div')
    lab.textContent = label
    lab.style.cssText = `font-size:11px!important;font-weight:600!important;color:${dark ? '#cbd5e1' : '#475569'}!important;margin-bottom:4px!important;`
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.readOnly = readonly
    input.style.cssText = fieldCss(readonly)
    wrap.appendChild(lab)
    wrap.appendChild(input)
    card.appendChild(wrap)
    return input
  }

  const rawInput = mkField('识别结果（原文）', opts.raw, true)
  const current = (opts.input.value || '').trim() || opts.filled
  const rightInput = mkField('正确结果', current, false)

  const btnRow = document.createElement('div')
  btnRow.style.cssText =
    'display:flex!important;gap:6px!important;margin-top:12px!important;justify-content:flex-end!important;flex-wrap:wrap!important;'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = '取消'
  cancelBtn.style.cssText = `padding:4px 10px!important;border:1px solid ${dark ? 'rgba(148,163,184,.3)' : '#e2e8f0'}!important;background:transparent!important;color:${dark ? '#cbd5e1' : '#475569'}!important;border-radius:6px!important;font-size:11px!important;cursor:pointer!important;font-weight:600!important;`
  cancelBtn.onclick = () => dismiss()

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.textContent = '保存到词表'
  saveBtn.style.cssText =
    'padding:4px 12px!important;border:none!important;background:#16a34a!important;color:#fff!important;border-radius:6px!important;font-size:11px!important;cursor:pointer!important;font-weight:600!important;'
  saveBtn.onclick = () => {
    void (async () => {
      const wrong = rawInput.value.trim()
      const right = rightInput.value.trim()
      if (!right) {
        rightInput.focus()
        return
      }
      try {
        saveBtn.disabled = true
        const status = await upsertCorrection(wrong, right)
        if (status !== 'removed' && opts.input.isConnected) {
          fillCaptchaInput(opts.input, right)
        }
        dismiss()
        const msg =
          status === 'added'
            ? `已添加：${wrong} → ${right}`
            : status === 'updated'
              ? `已更新：${wrong} → ${right}`
              : '已移除无变化项'
        void showCaptchaToast('纠错词表', msg, 'success')
      } catch (e) {
        saveBtn.disabled = false
        void showCaptchaToast('保存失败', String(e), 'error')
      }
    })()
  }

  btnRow.appendChild(cancelBtn)
  btnRow.appendChild(saveBtn)
  card.appendChild(btnRow)
  shadow.appendChild(card)

  window.setTimeout(() => {
    host.style.setProperty('right', '20px', 'important')
    rightInput.focus()
  }, 50)
}

function getExpectedCaptchaLength(input: HTMLInputElement): number | undefined {
  const maxLength = input.maxLength
  if (Number.isInteger(maxLength) && maxLength >= 3 && maxLength <= 8) return maxLength

  const text = `${getInputSearchText(input)} ${input.outerHTML}`
  const match = text.match(/(?:验证码|驗證碼|captcha|verify|verification|code)[^0-9]{0,16}([3-8])\s*(?:位|碼|码|digits?|chars?|characters?)/i)
  return match ? Number(match[1]) : undefined
}

function fillCaptchaInput(input: HTMLInputElement, captchaCode: string): boolean {
  try {
    if (isTotpTargetInput(input) || isExcludedCaptchaInput(input)) {
      log('拒绝填充两步验证/排除输入框', getElementSelector(input))
      return false
    }
    setInputValue(input, captchaCode)
    log('验证码已填充', captchaCode, '→', getElementSelector(input))
    return true
  } catch (error) {
    log('填充验证码失败', error)
    return false
  }
}

function resetCaptchaFilledIfTargetGone(): void {
  if (!captchaFilled) return
  const lastInput = lastCaptchaInputSelector
    ? (document.querySelector(lastCaptchaInputSelector) as HTMLInputElement | null)
    : null
  if (!lastInput || !isVisibleElement(lastInput)) {
    captchaFilled = false
    lastCaptchaImageSrc = ''
    lastCaptchaInputSelector = ''
    log('上次验证码输入框已消失，重置识别状态')
    return
  }
  const currentImage = (Array.from(document.querySelectorAll('img')) as HTMLImageElement[]).find(
    isLikelyCaptchaImage,
  )
  const currentImageSrc = currentImage ? getCaptchaImageSrc(currentImage) : ''
  if (
    currentImageSrc &&
    lastCaptchaImageSrc &&
    currentImageSrc !== lastCaptchaImageSrc &&
    !lastInput.value.trim()
  ) {
    captchaFilled = false
    lastCaptchaImageSrc = ''
    lastCaptchaInputSelector = ''
    log('检测到新的验证码图片，重置识别状态')
  }
}

async function processCaptcha(): Promise<boolean> {
  let failKey = ''
  try {
    if (captchaStopped || captchaFilled || captchaProcessing) return false
    if (!isExtensionContextValid()) {
      stopCaptchaAutoFill('extension context invalid')
      return false
    }
    if (await isCaptchaBlockedForHost()) return false

    captchaProcessing = true
    const detected = detectCaptchaElements()
    if (!detected) {
      captchaProcessing = false
      return false
    }

    const { image, input, imageSrc, confidence } = detected
    failKey = captchaCandidateKey(image, imageSrc, input)
    if (isExcludedImage(image) || isUnlikelyCaptchaGeometry(image)) {
      captchaProcessing = false
      return false
    }
    if (isTotpTargetInput(input) || isExcludedCaptchaInput(input)) {
      log('候选输入框是两步验证/排除项，放弃填充', {
        input: getElementSelector(input),
        confidence,
      })
      captchaProcessing = false
      return false
    }

    log('开始处理验证码', {
      imageSrc: imageSrc.startsWith('data:') ? `data:(${imageSrc.length}b)` : imageSrc.slice(0, 80),
      confidence,
      input: getElementSelector(input),
    })

    // 动态验证码 URL 常在每次请求时刷新服务端 Session；只能读取页面已显示的图片，禁止 fetch 原地址。
    const base64Img = await captureCaptchaImage(image, { upscale: true })
    log('已截取页面验证码图片', { offlinePreferred: captchaOfflinePreferred })

    if (!isExtensionContextValid()) {
      stopCaptchaAutoFill('extension context invalid')
      return false
    }

    const expectedLength = getExpectedCaptchaLength(input)
    const result = await recognizeCaptcha(base64Img, { expectedLength })
    const code = (result.text || '').trim()
    const raw = (result.raw || result.text || '').trim()
    if (!code) {
      const n = (captchaFailCounts.get(failKey) || 0) + 1
      captchaFailCounts.set(failKey, n)
      if (n <= MAX_CAPTCHA_FAILS_PER_KEY) {
        showCaptchaToast('识别失败', '结果为空', 'error')
      }
      captchaProcessing = false
      return false
    }

    if (isTotpTargetInput(input) || isExcludedCaptchaInput(input)) {
      log('填充前目标已变为两步验证框，取消写入')
      captchaProcessing = false
      return false
    }

    if (fillCaptchaInput(input, code)) {
      captchaFailCounts.delete(failKey)
      const provider =
        result.source === 'offline' ? '离线 OCR' : result.source === 'ai' ? 'AI' : '服务端 OCR'
      showCaptchaToastEx({
        title: '验证码已填充',
        type: 'success',
        code,
        raw: raw && raw !== code ? raw : undefined,
        source: provider,
        actions: [
          {
            label: '纠正',
            onClick: () => {
              openCaptchaCorrectDialog({
                raw: raw || code,
                filled: code,
                input,
                sourceLabel: provider,
              })
            },
          },
        ],
      })
      captchaFilled = true
      lastCaptchaImageSrc = imageSrc.startsWith('data:') ? failKey : imageSrc
      lastCaptchaInputSelector = getElementSelector(input)
      captchaProcessing = false
      return true
    }

    captchaProcessing = false
    return false
  } catch (error) {
    captchaProcessing = false
    if (isExtensionContextError(error) || !isExtensionContextValid()) {
      if (failKey) {
        captchaFailCounts.set(failKey, (captchaFailCounts.get(failKey) || 0) + 1)
      }
      stopCaptchaAutoFill(String(error))
      return false
    }
    if (failKey) {
      captchaFailCounts.set(failKey, (captchaFailCounts.get(failKey) || 0) + 1)
    }
    log('验证码处理失败', error)
    if (!failKey || (captchaFailCounts.get(failKey) || 0) <= MAX_CAPTCHA_FAILS_PER_KEY) {
      try {
        showCaptchaToast('识别失败', String(error), 'error')
      } catch {
        /* 宿主 DOM 或扩展上下文失效时跳过错误提示，识别流程仍按失败返回。 */
      }
    }
    return false
  }
}
