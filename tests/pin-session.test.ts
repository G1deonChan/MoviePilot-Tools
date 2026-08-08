import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, unknown>()

vi.mock('wxt/storage', () => ({
  storage: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { values.delete(key) }),
  },
}))

import {
  clearPinSessionUnlocked,
  isPinSessionUnlocked,
  markPinSessionUnlocked,
} from '../core/pin-session'

describe('PIN 浏览器会话解锁状态', () => {
  beforeEach(() => values.clear())

  it('popup 关闭重开后仍能读取当前浏览器会话解锁标记', async () => {
    expect(await isPinSessionUnlocked()).toBe(false)
    await markPinSessionUnlocked()
    expect(await isPinSessionUnlocked()).toBe(true)
  })

  it('锁定后清除会话解锁标记', async () => {
    await markPinSessionUnlocked()
    await clearPinSessionUnlocked()
    expect(await isPinSessionUnlocked()).toBe(false)
  })
})
