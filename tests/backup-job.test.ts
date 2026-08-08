import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, unknown>()
const backupToMp = vi.fn()
const backupNow = vi.fn()
const sendMessage = vi.fn(() => Promise.resolve())
const createNotification = vi.fn()

vi.mock('wxt/storage', () => ({
  storage: {
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)) }),
  },
}))
vi.mock('../services/mp-backup', () => ({ backupToMp: (...args: unknown[]) => backupToMp(...args) }))
vi.mock('../services/webdav', () => ({ backupNow: (...args: unknown[]) => backupNow(...args) }))

vi.stubGlobal('chrome', {
  runtime: { sendMessage, getURL: (path: string) => `chrome-extension://id${path}` },
  notifications: { create: createNotification },
})

import {
  acknowledgeBackupJob,
  getBackupJobState,
  markInterruptedBackupJob,
  startBackupJob,
} from '../services/backup-job'

describe('后台备份任务管理器', () => {
  beforeEach(() => {
    values.clear()
    backupToMp.mockReset()
    backupNow.mockReset()
    sendMessage.mockClear()
    createNotification.mockClear()
  })

  it('任务启动后立即持久化运行状态并持续写入进度', async () => {
    let finish!: () => void
    backupToMp.mockImplementation(async (onProgress: (progress: unknown) => void) => {
      onProgress({ phase: 'uploading', label: '上传中', percent: 60 })
      await new Promise<void>((resolve) => { finish = resolve })
      return 'backups/id/manifest.json'
    })

    const started = await startBackupJob('mp')
    expect(started.status).toBe('running')
    await vi.waitFor(async () => {
      expect((await getBackupJobState())?.progress.percent).toBe(60)
    })
    finish()
    await vi.waitFor(async () => {
      expect((await getBackupJobState())?.status).toBe('completed')
    })
    expect(createNotification).toHaveBeenCalledOnce()
  })

  it('运行中重复启动返回同一任务，不重复执行上传', async () => {
    let finish!: () => void
    backupNow.mockImplementation(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      return 'id/manifest.json'
    })
    const first = await startBackupJob('webdav')
    const second = await startBackupJob('mp')
    expect(second.id).toBe(first.id)
    expect(backupNow).toHaveBeenCalledOnce()
    expect(backupToMp).not.toHaveBeenCalled()
    finish()
  })

  it('完成状态只确认一次，Service Worker 重启后将遗留运行态标记为失败', async () => {
    values.set('session:mpt2.backup-job', {
      id: 'old', target: 'mp', trigger: 'manual', status: 'running',
      progress: { phase: 'uploading', label: '上传中', percent: 40 },
      startedAt: 1, updatedAt: 1,
    })
    await markInterruptedBackupJob()
    expect((await getBackupJobState())?.status).toBe('failed')
    const acknowledged = await acknowledgeBackupJob('old')
    expect(acknowledged?.acknowledgedAt).toBeTypeOf('number')
    const again = await acknowledgeBackupJob('old')
    expect(again?.acknowledgedAt).toBe(acknowledged?.acknowledgedAt)
  })
})
