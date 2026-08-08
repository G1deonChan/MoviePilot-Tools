import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const storageGet = vi.fn()
const storageSet = vi.fn()
const root = {
  dataset: {} as Record<string, string>,
  classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
  style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  setAttribute: vi.fn(),
  removeAttribute: vi.fn(),
}

let theme: typeof import('../core/theme')

vi.mock('../core/storage', () => ({
  STORAGE_KEYS: {
    THEME: 'theme',
    CUSTOM_BG_CONFIG: 'custom-bg',
  },
  storageGet,
  storageSet,
}))

vi.mock('../core/http', () => ({
  api: { get: vi.fn() },
}))

vi.mock('../core/asset-repository', () => ({
  clearBackgroundAsset: vi.fn(),
  getBackgroundAsset: vi.fn().mockResolvedValue(''),
  saveBackgroundAsset: vi.fn(),
}))

describe('主题与背景状态', () => {
  beforeAll(async () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({})),
      documentElement: root,
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
    })
    theme = await import('../core/theme')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('手动主题写入 DOM 和共享状态', async () => {
    const { applyTheme, currentTheme, themeState } = theme

    await applyTheme('dark')

    expect(currentTheme()).toBe('dark')
    expect(themeState.pref).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(storageSet).toHaveBeenCalledWith('theme', 'dark')
  })

  it('深色主题禁用自定义背景激活状态', () => {
    const { bgState, isBgActive, themeState } = theme
    bgState.enabled = true
    bgState.image = 'data:image/png;base64,AA=='
    themeState.resolved = 'dark'
    expect(isBgActive()).toBe(false)
    themeState.resolved = 'light'
    expect(isBgActive()).toBe(true)
  })
})
