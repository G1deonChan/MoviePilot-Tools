import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'

// 联调凭据仅由进程环境提供；私有数据在内存中使用，测试结束即清理。
let store: PrivateStoreV1 = { schema: 1 }
vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(store)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void) => {
    mutator(store)
    return structuredClone(store)
  }),
}))
vi.mock('../core/storage', () => ({ STORAGE_KEYS: {}, storageGet: vi.fn(), storageSet: vi.fn() }))
vi.mock('../core/store-repository', () => ({ getPublicStore: vi.fn(async () => ({})), updatePublicStore: vi.fn() }))

import { login, ping } from '../services/auth'
import { fetchCurrentUser } from '../services/user'
import { fetchSites } from '../services/site-manage'
import { fetchSupportingSites } from '../services/site-supporting'
import { fetchClients, fetchDirectories, fetchTasks, resolveSiteTorrent } from '../services/download'
import { findTorrentForPage } from '../services/site-torrent'
import { fetchAgentCapability, listAgentSessions, listAgentCommands } from '../services/agent'
import { request } from '../core/http'

const base = process.env.MPT_TEST_BASE_URL
const username = process.env.MPT_TEST_USERNAME
const password = process.env.MPT_TEST_PASSWORD

describe.skipIf(!base || !username || !password)('MoviePilot v3 只读实例联调', () => {
  beforeAll(async () => {
    const result = await login(base!, username!, password!)
    expect(result.success, result.message).toBe(true)
  }, 30000)
  afterAll(() => { store = { schema: 1 } })

  it('登录后的当前用户和会话可用', async () => {
    expect(await ping()).toBe(true)
    expect(typeof (await fetchCurrentUser())?.name).toBe('string')
  })

  it('站点列表可解析并以数组缓存在私有仓', async () => {
    const sites = await fetchSites()
    expect(Array.isArray(sites)).toBe(true)
    expect(Array.isArray(store.sites)).toBe(true)
    const supporting = await fetchSupportingSites(true)
    expect(typeof supporting).toBe('object')
    expect('success' in supporting).toBe(false)
  })

  it('下载器、路径和当前任务保持数组合同', async () => {
    const clients = await fetchClients()
    const directories = await fetchDirectories()
    const tasks = await fetchTasks()
    expect(Array.isArray(clients)).toBe(true)
    expect(Array.isArray(tasks)).toBe(true)
    expect(Array.isArray(directories)).toBe(true)
    expect(directories.every((item) => typeof item.save_path === 'string')).toBe(true)
    expect(clients.every((item) => typeof item.name === 'string')).toBe(true)
  })

  it('助手能力、快捷命令和会话可解析', async () => {
    expect(typeof (await fetchAgentCapability()).enabled).toBe('boolean')
    expect(Array.isArray(await listAgentCommands())).toBe(true)
    expect(Array.isArray(await listAgentSessions(1, 1))).toBe(true)
  })

  it('服务端识别接口返回解包后的媒体上下文', async () => {
    const result = await request('/api/v1/media/recognize', { query: { title: 'The.Matrix.1999' } })
    expect(result.ok, result.error).toBe(true)
    expect(result.data).toHaveProperty('media_info')
  }, 30000)

  it.skipIf(!process.env.MPT_TEST_TARGET_PAGE || !process.env.MPT_TEST_TARGET_TITLE)('定位指定详情页种子，不提交下载', async () => {
    const page = process.env.MPT_TEST_TARGET_PAGE!
    const host = new URL(page).hostname
    const sites = await fetchSites()
    const site = sites.find((item) => item.domain.includes(host) || item.url?.includes(host))
    expect(!!site).toBe(true)
    const result = await resolveSiteTorrent(site!.id, page, process.env.MPT_TEST_TARGET_TITLE)
    expect(result.ok, result.message).toBe(true)
    expect(!!result.torrent?.enclosure).toBe(true)
    expect(!!findTorrentForPage(page, [result.torrent!])).toBe(true)
  }, 60000)
})
