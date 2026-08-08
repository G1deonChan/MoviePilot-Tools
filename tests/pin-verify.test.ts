import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'

let store: PrivateStoreV1 = { schema: 1 }

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(store)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    const draft = structuredClone(store)
    mutator(draft)
    store = draft
    return structuredClone(store)
  }),
}))
vi.mock('../core/pin-session', () => ({
  markPinSessionUnlocked: vi.fn(),
  clearPinSessionUnlocked: vi.fn(),
  isPinSessionUnlocked: vi.fn(async () => false),
}))
vi.mock('../services/webdav', () => ({ scheduleAutoBackupOnChange: vi.fn() }))
vi.mock('../services/mp-backup', () => ({ scheduleMpAutoBackupOnChange: vi.fn() }))

import { hasPin, setPin, verifyPin } from '../services/credential'

describe('危险操作 PIN 验证', () => {
  beforeEach(() => { store = { schema: 1 } })

  it('未设置 PIN 时验证失败', async () => {
    expect(await hasPin()).toBe(false)
    expect(await verifyPin('123456')).toBe(false)
  })

  it('正确 PIN 通过，错误 PIN 拒绝', async () => {
    await setPin('123456')
    expect(await verifyPin('123456')).toBe(true)
    expect(await verifyPin('654321')).toBe(false)
  })
})
