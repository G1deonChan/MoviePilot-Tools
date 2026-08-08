// 按月或手动批量打开站点，并按配置自动关闭标签页。
// - 每月首次打开
// - 定时间隔打开（按天）
// - 可选自动关闭标签页 + 保留登录页
import { STORAGE_KEYS, storageGet, storageSet, storageRemove } from '../core/storage'
import { fetchSites } from './site-manage'
import { ALARM, reconfigureAlarm } from '../core/alarms'

export interface SiteAutoOpenConfig {
  /** 每月首次打开浏览器/扩展启动时自动打开 */
  monthlyFirstEnabled: boolean
  /** 按间隔定时打开 */
  intervalEnabled: boolean
  /** 定时间隔（天） */
  intervalDays: number
  /** 打开后自动关闭标签页 */
  autoCloseEnabled: boolean
  /** 关闭延迟（分钟） */
  closeDelayMinutes: number
  /** 自动关闭时保留标题含「登录」等关键词的标签页 */
  keepLoginTabsEnabled: boolean
}

export const SITE_AUTO_OPEN_INTERVAL_PRESETS = [
  { label: '1 天', value: 1 },
  { label: '3 天', value: 3 },
  { label: '5 天', value: 5 },
  { label: '7 天', value: 7 },
  { label: '10 天', value: 10 },
  { label: '15 天', value: 15 },
  { label: '20 天', value: 20 },
  { label: '25 天', value: 25 },
  { label: '30 天', value: 30 },
] as const

export const SITE_AUTO_CLOSE_DELAY_PRESETS = [
  { label: '1 分钟', value: 1 },
  { label: '3 分钟', value: 3 },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '60 分钟', value: 60 },
] as const

const DEFAULT: SiteAutoOpenConfig = {
  monthlyFirstEnabled: false,
  intervalEnabled: false,
  intervalDays: 7,
  autoCloseEnabled: false,
  keepLoginTabsEnabled: true,
  closeDelayMinutes: 5,
}

function normalizeIntervalDays(value?: number): number {
  return SITE_AUTO_OPEN_INTERVAL_PRESETS.find((i) => i.value === value)?.value ?? DEFAULT.intervalDays
}

function normalizeCloseDelayMinutes(value?: number): number {
  return (
    SITE_AUTO_CLOSE_DELAY_PRESETS.find((i) => i.value === value)?.value ?? DEFAULT.closeDelayMinutes
  )
}

function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export async function loadSiteAutoOpenConfig(): Promise<SiteAutoOpenConfig> {
  const raw = await storageGet<Partial<SiteAutoOpenConfig>>(STORAGE_KEYS.SITE_AUTO_OPEN_CONFIG)
  if (!raw) return { ...DEFAULT }
  return {
    monthlyFirstEnabled: !!raw.monthlyFirstEnabled,
    intervalEnabled: !!raw.intervalEnabled,
    intervalDays: normalizeIntervalDays(raw.intervalDays),
    autoCloseEnabled: !!raw.autoCloseEnabled,
    keepLoginTabsEnabled: raw.keepLoginTabsEnabled !== false,
    closeDelayMinutes: normalizeCloseDelayMinutes(raw.closeDelayMinutes),
  }
}

export async function saveSiteAutoOpenConfig(cfg: SiteAutoOpenConfig): Promise<void> {
  const next: SiteAutoOpenConfig = {
    monthlyFirstEnabled: !!cfg.monthlyFirstEnabled,
    intervalEnabled: !!cfg.intervalEnabled,
    intervalDays: normalizeIntervalDays(cfg.intervalDays),
    autoCloseEnabled: !!cfg.autoCloseEnabled,
    keepLoginTabsEnabled: cfg.keepLoginTabsEnabled !== false,
    closeDelayMinutes: normalizeCloseDelayMinutes(cfg.closeDelayMinutes),
  }
  await storageSet(STORAGE_KEYS.SITE_AUTO_OPEN_CONFIG, next)
  // 仅「定时打开」控制周期 alarm（天 → 分钟）
  await reconfigureAlarm(
    ALARM.SITE_AUTO_OPEN,
    next.intervalEnabled,
    next.intervalDays * 24 * 60,
  )
}

export async function shouldRunMonthlySiteAutoOpen(): Promise<boolean> {
  const last = await storageGet<string>(STORAGE_KEYS.SITE_AUTO_OPEN_LAST_MONTH)
  return last !== monthKey()
}

export async function markMonthlySiteAutoOpened(): Promise<void> {
  await storageSet(STORAGE_KEYS.SITE_AUTO_OPEN_LAST_MONTH, monthKey())
}

async function scheduleCloseTabs(tabIds: number[], delayMinutes: number): Promise<void> {
  await storageSet(STORAGE_KEYS.SITE_AUTO_OPEN_TABS, tabIds)
  await chrome.alarms.clear(ALARM.SITE_AUTO_OPEN_CLOSE)
  if (tabIds.length > 0 && delayMinutes > 0) {
    chrome.alarms.create(ALARM.SITE_AUTO_OPEN_CLOSE, { delayInMinutes: delayMinutes })
  }
}

/** 立即打开全部启用站点（后台标签，分批），返回打开数量 */
export async function openAllSites(
  reason: 'monthly' | 'interval' | 'manual' = 'manual',
): Promise<number> {
  void reason
  const cfg = await loadSiteAutoOpenConfig()
  const sites = (await fetchSites()).filter(
    (s) => s.is_active !== false && !s.isDisabled && (s.url || s.domain),
  )
  const tabIds: number[] = []
  const batchSize = 5
  for (let i = 0; i < sites.length; i += batchSize) {
    const batch = sites.slice(i, i + batchSize)
    const tabs = await Promise.all(
      batch.map(async (site) => {
        const url = site.url || `https://${site.domain}`
        return chrome.tabs.create({ url, active: false }).catch(() => null)
      }),
    )
    for (const tab of tabs) {
      if (tab?.id !== undefined) tabIds.push(tab.id)
    }
    if (i + batchSize < sites.length) await delay(500)
  }

  if (cfg.autoCloseEnabled && tabIds.length) {
    await scheduleCloseTabs(tabIds, cfg.closeDelayMinutes)
  }
  return tabIds.length
}

/** 关闭自动打开的标签页（可保留登录页） */
export async function closeAutoOpenedTabs(): Promise<void> {
  const tabIds = (await storageGet<number[]>(STORAGE_KEYS.SITE_AUTO_OPEN_TABS)) ?? []
  if (!tabIds.length) return
  const cfg = await loadSiteAutoOpenConfig()
  const loginTitlePattern = /(登录|登陆|login|sign\s*in|signin)/i

  for (const tabId of tabIds) {
    try {
      if (cfg.keepLoginTabsEnabled) {
        const tab = await chrome.tabs.get(tabId)
        if (tab.title && loginTitlePattern.test(tab.title)) continue
      }
      await chrome.tabs.remove(tabId)
    } catch {
      /* tab may already be closed */
    }
  }
  await storageRemove(STORAGE_KEYS.SITE_AUTO_OPEN_TABS)
}

/** 每月首次：若开启且本月未跑过则打开 */
export async function runMonthlySiteAutoOpenIfNeeded(): Promise<number | null> {
  const cfg = await loadSiteAutoOpenConfig()
  if (!cfg.monthlyFirstEnabled) return null
  if (!(await shouldRunMonthlySiteAutoOpen())) return null
  const n = await openAllSites('monthly')
  await markMonthlySiteAutoOpened()
  return n
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
