import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '../core/storage'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  forwardToOffscreen: vi.fn(),
}))

vi.mock('../core/storage', async () => {
  const actual = await vi.importActual<typeof import('../core/storage')>('../core/storage')
  return {
    ...actual,
    storageGet: vi.fn(async (key: string) => mocks.storage.get(key)),
    storageSet: vi.fn(async (key: string, value: unknown) => mocks.mocks.storage.set(key, value)),
  }
})

vi.mock('../core/auth-session', () => ({
  getActiveBaseUrl: vi.fn(async () => ''),
}))

vi.mock('../core/http', () => ({
  api: { get: vi.fn(async () => ({ ok: false })) },
}))

vi.mock('../core/offscreen', () => ({
  ensureOffscreenDocument: vi.fn(async () => undefined),
}))

vi.mock('../core/bus', async () => {
  const actual = await vi.importActual<typeof import('../core/bus')>('../core/bus')
  return {
    ...actual,
    forwardToOffscreen: mocks.forwardToOffscreen,
  }
})

vi.mock('../services/ocr-runtime', () => ({
  getOcrRuntimeStatus: vi.fn(async () => ({ ready: true, missing: [], meta: null })),
}))

vi.mock('../services/ocr-models', () => ({
  loadActiveOcrModelForInference: vi.fn(async () => ({
    modelId: 'model-id',
    profile: 'ddddocr',
  })),
}))

import { recognizeCaptchaInBackground } from '../services/captcha'

afterEach(() => {
  mocks.storage.clear()
  mocks.forwardToOffscreen.mockReset()
  vi.unstubAllGlobals()
})

describe('验证码识别结果完整性', () => {
  it('固定六位时拒绝离线 OCR 的两位结果并使用完整服务端结果', async () => {
    mocks.storage.set(STORAGE_KEYS.WEB_EMBED_FEATURES, { captchaOfflineOcrEnabled: true })
    mocks.forwardToOffscreen.mockResolvedValue('A7')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: 'AB12CD' }),
    })))

    const result = await recognizeCaptchaInBackground('base64-image', { expectedLength: 6 })

    expect(result).toEqual({ text: 'AB12CD', raw: 'AB12CD', source: 'server' })
  })

  it('未提供固定长度时也拒绝一至两位结果', async () => {
    mocks.storage.set(STORAGE_KEYS.WEB_EMBED_FEATURES, { captchaOfflineOcrEnabled: true })
    mocks.forwardToOffscreen.mockResolvedValue('Q')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: 'A1B2' }),
    })))

    const result = await recognizeCaptchaInBackground('base64-image')

    expect(result).toEqual({ text: 'A1B2', raw: 'A1B2', source: 'server' })
  })

  it('所有来源位数都不符时明确失败而不是填充短结果', async () => {
    mocks.storage.set(STORAGE_KEYS.WEB_EMBED_FEATURES, { captchaOfflineOcrEnabled: true })
    mocks.forwardToOffscreen.mockResolvedValue('A7')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: 'ABC' }),
    })))

    await expect(
      recognizeCaptchaInBackground('base64-image', { expectedLength: 6 }),
    ).rejects.toThrow('位数不符')
  })
})
