import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addRuntimeMessageListener,
  isExtensionContextError,
  isExtensionContextValid,
} from '../core/extension-context'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('内容脚本扩展上下文保护', () => {
  it('上下文有效时注册 runtime 消息监听', () => {
    const addListener = vi.fn()
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', onMessage: { addListener } } })
    const listener = vi.fn()

    expect(isExtensionContextValid()).toBe(true)
    expect(addRuntimeMessageListener(listener)).toBe(true)
    expect(addListener).toHaveBeenCalledOnce()
    expect(addListener).toHaveBeenCalledWith(listener)
  })

  it('扩展重载后 runtime id 缺失时静默跳过', () => {
    const addListener = vi.fn()
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener } } })

    expect(isExtensionContextValid()).toBe(false)
    expect(addRuntimeMessageListener(vi.fn())).toBe(false)
    expect(addListener).not.toHaveBeenCalled()
  })

  it('识别扩展重载及消息端口失效错误', () => {
    expect(isExtensionContextError(new Error('Extension context invalidated.'))).toBe(true)
    expect(isExtensionContextError(new Error('The message port closed before a response was received.'))).toBe(true)
    expect(isExtensionContextError(new Error('普通业务错误'))).toBe(false)
  })

  it('读取 onMessage 抛出 context invalidated 时不向页面抛错', () => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'stale-extension-id',
        get onMessage() {
          throw new Error("Failed to read the 'onMessage' property from 'Object': Extension context invalidated.")
        },
      },
    })

    expect(() => addRuntimeMessageListener(vi.fn())).not.toThrow()
    expect(addRuntimeMessageListener(vi.fn())).toBe(false)
  })
})
