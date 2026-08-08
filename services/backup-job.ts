import { storage } from 'wxt/storage'
import { MSG } from '../core/bus'
import type { BackupProgress } from './backup-schema'
import { backupToMp } from './mp-backup'
import { backupNow } from './webdav'

export type BackupJobTarget = 'mp' | 'webdav'
export type BackupJobStatus = 'running' | 'completed' | 'failed'
export type BackupJobTrigger = 'manual' | 'scheduled' | 'change'

export interface BackupJobState {
  id: string
  target: BackupJobTarget
  trigger: BackupJobTrigger
  status: BackupJobStatus
  progress: BackupProgress
  startedAt: number
  updatedAt: number
  completedAt?: number
  result?: string
  error?: string
  acknowledgedAt?: number
}

const JOB_KEY = 'session:mpt2.backup-job' as const
let activeJob: Promise<BackupJobState> | null = null
let stateWriteQueue: Promise<void> = Promise.resolve()

function initialProgress(target: BackupJobTarget): BackupProgress {
  return {
    phase: 'validating',
    label: target === 'mp' ? '正在启动 MoviePilot 备份' : '正在启动 WebDAV 备份',
    percent: 0,
    indeterminate: true,
  }
}

async function saveState(state: BackupJobState): Promise<void> {
  const snapshot = structuredClone(state)
  const write = stateWriteQueue.then(async () => {
    await storage.setItem(JOB_KEY, snapshot)
    void chrome.runtime.sendMessage({ type: MSG.BACKUP_JOB_UPDATED, payload: snapshot }).catch(() => undefined)
  })
  stateWriteQueue = write.catch(() => undefined)
  await write
}

async function notifyResult(state: BackupJobState): Promise<void> {
  if (!chrome.notifications) return
  const success = state.status === 'completed'
  chrome.notifications.create(`mpt2-backup-${state.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('/icons/icon-128.png'),
    title: success ? 'MoviePilot Tools 备份完成' : 'MoviePilot Tools 备份失败',
    message: success
      ? `${state.target === 'mp' ? 'MoviePilot' : 'WebDAV'} 备份已完成`
      : state.error || '备份执行失败',
  })
}

export async function getBackupJobState(): Promise<BackupJobState | null> {
  return storage.getItem<BackupJobState>(JOB_KEY)
}

export async function acknowledgeBackupJob(id: string): Promise<BackupJobState | null> {
  const state = await getBackupJobState()
  if (!state || state.id !== id || state.acknowledgedAt) return state
  const next = { ...state, acknowledgedAt: Date.now(), updatedAt: Date.now() }
  await storage.setItem(JOB_KEY, next)
  return next
}

export async function startBackupJob(
  target: BackupJobTarget,
  trigger: BackupJobTrigger = 'manual',
): Promise<BackupJobState> {
  const existing = await getBackupJobState()
  if (existing?.status === 'running') return existing
  if (activeJob) return activeJob

  const now = Date.now()
  const state: BackupJobState = {
    id: crypto.randomUUID(),
    target,
    trigger,
    status: 'running',
    progress: initialProgress(target),
    startedAt: now,
    updatedAt: now,
  }
  await saveState(state)

  activeJob = (async () => {
    try {
      const run = target === 'mp' ? backupToMp : backupNow
      let progressWrite = Promise.resolve()
      const result = await run((progress) => {
        state.progress = { ...progress }
        state.updatedAt = Date.now()
        progressWrite = saveState({ ...state })
      })
      await progressWrite
      state.status = 'completed'
      state.result = result
      state.progress = { phase: 'completed', label: `${target === 'mp' ? 'MoviePilot' : 'WebDAV'} 备份完成`, percent: 100 }
    } catch (error) {
      state.status = 'failed'
      state.error = error instanceof Error ? error.message : String(error)
      state.progress = {
        ...state.progress,
        phase: 'failed',
        label: `备份失败：${state.error}`,
        indeterminate: false,
      }
    }
    state.completedAt = Date.now()
    state.updatedAt = state.completedAt
    await saveState({ ...state })
    await notifyResult(state).catch(() => undefined)
    return { ...state }
  })().finally(() => {
    activeJob = null
  })

  return state
}

export async function runBackupJob(
  target: BackupJobTarget,
  trigger: BackupJobTrigger = 'scheduled',
): Promise<BackupJobState> {
  const started = await startBackupJob(target, trigger)
  if (started.status !== 'running' || !activeJob) return started
  return activeJob
}

export async function markInterruptedBackupJob(): Promise<void> {
  const state = await getBackupJobState()
  if (!state || state.status !== 'running' || activeJob) return
  const next: BackupJobState = {
    ...state,
    status: 'failed',
    error: '后台备份进程已中断，请重新发起备份',
    progress: {
      ...state.progress,
      phase: 'failed',
      label: '后台备份进程已中断，请重新发起备份',
      indeterminate: false,
    },
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }
  await saveState(next)
}
