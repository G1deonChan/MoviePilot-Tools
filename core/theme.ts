// 主题管理：写入 data-theme、持久化、启动恢复、THEME_LIST 供 UI 消费
// 自定义背景：配置 + 图片分离存储，支持模糊/透明度/URL/MP 壁纸/每日壁纸（仅浅色生效）
import { reactive } from 'vue'
import { STORAGE_KEYS, storageGet, storageSet } from './storage'
import { api } from './http'
import { clearBackgroundAsset, getBackgroundAsset, saveBackgroundAsset } from './asset-repository'

export interface ThemeItem {
  name: string
  label: string
}

export const THEME_LIST: ThemeItem[] = [
  { name: 'light', label: '浅色' },
  { name: 'dark', label: '深色' },
  { name: 'auto', label: '自动' },
]

export interface CustomBgConfig {
  enabled: boolean
  blurEnabled: boolean
  blur: number
  opacity: number
  url: string
}

export const DEFAULT_CUSTOM_BG_CONFIG: CustomBgConfig = {
  enabled: false,
  blurEnabled: false,
  blur: 5,
  opacity: 0.5,
  url: '',
}

/** 响应式背景状态，供 AppShell / 设置页共享 */
export const bgState = reactive({
  enabled: false,
  blurEnabled: false,
  blur: 5,
  opacity: 0.5,
  url: '',
  image: '',
})

export type ThemePref = 'light' | 'dark' | 'auto'

/** 响应式主题状态：顶栏切换与设置页共用，避免图标/选项不同步 */
export const themeState = reactive({
  /** 用户偏好：light / dark / auto */
  pref: 'light' as ThemePref,
  /** 实际生效：light / dark（auto 已解析） */
  resolved: 'light' as 'light' | 'dark',
})

let mq: MediaQueryList | null = null

function systemPref(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function setDomTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  themeState.resolved = theme
}

function ensureAutoListener(): void {
  if (mq || typeof window === 'undefined' || !window.matchMedia) return
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    if (themeState.pref === 'auto') {
      setDomTheme(systemPref())
      applyBackgroundDom()
    }
  })
}

export async function applyTheme(name: string): Promise<void> {
  const pref: ThemePref = name === 'dark' ? 'dark' : name === 'auto' ? 'auto' : 'light'
  themeState.pref = pref
  const resolved = pref === 'auto' ? systemPref() : pref
  setDomTheme(resolved)
  await storageSet(STORAGE_KEYS.THEME, pref)
  ensureAutoListener()
  applyBackgroundDom()
}

export async function initTheme(): Promise<void> {
  const saved = await storageGet<string>(STORAGE_KEYS.THEME)
  const pref: ThemePref = saved === 'dark' || saved === 'auto' ? saved : 'light'
  await applyTheme(pref)
}

export function currentTheme(): string {
  return themeState.resolved || document.documentElement.dataset.theme || 'light'
}

// 自定义背景

export function isBgActive(): boolean {
  return bgState.enabled && !!bgState.image && currentTheme() !== 'dark'
}

function syncBgStateFromConfig(cfg: CustomBgConfig, image?: string): void {
  bgState.enabled = cfg.enabled
  bgState.blurEnabled = cfg.blurEnabled
  bgState.blur = cfg.blur
  bgState.opacity = cfg.opacity
  bgState.url = cfg.url
  if (image !== undefined) bgState.image = image
}

function applyBackgroundDom(): void {
  const active = isBgActive()
  const root = document.documentElement
  const body = document.body
  if (active) {
    root.style.setProperty('--mp-bg-image', `url("${bgState.image}")`)
    root.style.setProperty('--mp-bg-opacity', String(bgState.opacity))
    root.style.setProperty(
      '--mp-bg-filter',
      bgState.blurEnabled ? `blur(${bgState.blur}px)` : 'none',
    )
    root.style.setProperty('--mp-bg-scale', bgState.blurEnabled ? '1.08' : '1')
    root.setAttribute('data-bg', '')
    root.classList.add('has-custom-bg-body')
    body?.classList.add('has-custom-bg-body')
  } else {
    root.removeAttribute('data-bg')
    root.classList.remove('has-custom-bg-body')
    body?.classList.remove('has-custom-bg-body')
    root.style.removeProperty('--mp-bg-image')
    root.style.removeProperty('--mp-bg-opacity')
    root.style.removeProperty('--mp-bg-filter')
    root.style.removeProperty('--mp-bg-scale')
  }
}

export async function loadCustomBgConfig(): Promise<CustomBgConfig> {
  const cfg = await storageGet<Partial<CustomBgConfig>>(STORAGE_KEYS.CUSTOM_BG_CONFIG)
  return { ...DEFAULT_CUSTOM_BG_CONFIG, ...(cfg ?? {}) }
}

export async function saveCustomBgConfig(cfg: CustomBgConfig): Promise<void> {
  await storageSet(STORAGE_KEYS.CUSTOM_BG_CONFIG, cfg)
  syncBgStateFromConfig(cfg)
  applyBackgroundDom()
}

export async function getCustomBgImage(): Promise<string> {
  return getBackgroundAsset()
}

export async function saveCustomBgImage(dataUrl: string): Promise<void> {
  await saveBackgroundAsset(dataUrl)
  bgState.image = dataUrl
  applyBackgroundDom()
}

export async function clearCustomBgImage(): Promise<void> {
  await clearBackgroundAsset()
  bgState.image = ''
  applyBackgroundDom()
}

/** 启动时加载新版背景配置与图片。 */
export async function initBackground(): Promise<void> {
  const cfg = await loadCustomBgConfig()
  const image = await getCustomBgImage()

  syncBgStateFromConfig(cfg, image)
  applyBackgroundDom()

  // 每日壁纸：打开 popup 时检查
  void maybeFetchDailyWallpaper(false)
}

/** 设置或清除背景图；深色主题不显示自定义背景，因此返回 false。 */
export async function setBackground(dataUrl: string | null): Promise<boolean> {
  if (dataUrl) {
    await saveCustomBgImage(dataUrl)
    if (!bgState.enabled) {
      const cfg = await loadCustomBgConfig()
      cfg.enabled = true
      await saveCustomBgConfig(cfg)
    } else {
      applyBackgroundDom()
    }
  } else {
    await clearCustomBgImage()
  }
  if (currentTheme() === 'dark') return false
  return !!dataUrl && bgState.enabled
}

// 图片压缩与下载

export function compressAndResizeImage(fileOrBlob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        const maxDimension = 1000
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('无法创建 Canvas 上下文'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(fileOrBlob)
  })
}

export async function downloadAndCompressImage(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载图片失败 (HTTP ${response.status})`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('获取的文件不是有效的图片格式')
  return compressAndResizeImage(blob)
}

// MP 壁纸与每日壁纸

function parseWallpaperList(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.filter((u): u is string => typeof u === 'string' && !!u)
  }
  if (data && typeof data === 'object') {
    const d = data as { data?: unknown }
    if (Array.isArray(d.data)) {
      return d.data.filter((u): u is string => typeof u === 'string' && !!u)
    }
  }
  return []
}

function parseWallpaperUrl(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const d = data as { message?: unknown; data?: unknown }
    if (typeof d.message === 'string') return d.message
    if (typeof d.data === 'string') return d.data
  }
  return ''
}

export async function fetchMpWallpapers(): Promise<string[]> {
  const res = await api.get<unknown>('/api/v1/login/wallpapers')
  if (!res.ok) throw new Error(res.error || '获取壁纸失败')
  return parseWallpaperList(res.data)
}

export async function applyImageAsBackground(
  dataUrl: string,
  sourceUrl = '',
  enable = true,
): Promise<void> {
  await saveCustomBgImage(dataUrl)
  const cfg = await loadCustomBgConfig()
  if (sourceUrl) cfg.url = sourceUrl
  if (enable) cfg.enabled = true
  await saveCustomBgConfig(cfg)
}

export async function isDailyWallpaperEnabled(): Promise<boolean> {
  return (await storageGet<boolean>(STORAGE_KEYS.DAILY_WALLPAPER_ENABLED)) === true
}

export async function setDailyWallpaperEnabled(enabled: boolean): Promise<void> {
  await storageSet(STORAGE_KEYS.DAILY_WALLPAPER_ENABLED, enabled)
}

async function markDailyWallpaperFetched(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await storageSet(STORAGE_KEYS.LAST_DAILY_WALLPAPER_DATE, today)
}

/** 获取并应用每日壁纸；quiet=true 时不抛错到 UI */
export async function fetchDailyWallpaper(quiet = false): Promise<boolean> {
  try {
    const res = await api.get<unknown>('/api/v1/login/wallpaper')
    if (!res.ok) {
      if (!quiet) throw new Error(res.error || '获取每日壁纸失败')
      return false
    }
    const wallpaperUrl = parseWallpaperUrl(res.data)
    if (!wallpaperUrl) {
      if (!quiet) throw new Error('未获取到每日壁纸')
      return false
    }
    const base64 = await downloadAndCompressImage(wallpaperUrl)
    await applyImageAsBackground(base64, wallpaperUrl, true)
    await markDailyWallpaperFetched()
    return true
  } catch (e) {
    if (!quiet) throw e
    console.warn('每日壁纸获取失败:', e)
    return false
  }
}

export async function maybeFetchDailyWallpaper(force = false): Promise<void> {
  const enabled = await isDailyWallpaperEnabled()
  if (!enabled) return
  const today = new Date().toISOString().slice(0, 10)
  const last = (await storageGet<string>(STORAGE_KEYS.LAST_DAILY_WALLPAPER_DATE)) || ''
  if (!force && last === today) return
  await fetchDailyWallpaper(true)
}
