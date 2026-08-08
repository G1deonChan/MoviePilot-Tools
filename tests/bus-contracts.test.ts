import { describe, expect, it } from 'vitest'
import { MSG } from '../core/bus'

const MSG_VALUES = Object.values(MSG)

describe('Runtime 消息契约', () => {
  it('所有消息名称唯一', () => {
    expect(new Set(MSG_VALUES).size).toBe(MSG_VALUES.length)
  })

  it('Popup OCR 重置请求与 Offscreen 执行消息相互隔离', () => {
    expect(MSG.OCR_RESET_SESSION).not.toBe(MSG.OFFSCREEN_OCR_RESET_SESSION)
  })

  it('保留桥接兼容消息和备份任务广播名称', () => {
    expect(MSG.MP_BRIDGE_READY).toBe('MP_BRIDGE_READY')
    expect(MSG.BACKUP_JOB_UPDATED).toBe('BACKUP_JOB_UPDATED')
  })
})
