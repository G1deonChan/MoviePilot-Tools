import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateStoreV1 } from '../core/storage-contracts'

let store: PrivateStoreV1 = { schema: 1 }

vi.mock('../core/private-vault', () => ({
  getPrivateStore: vi.fn(async () => structuredClone(store)),
  updatePrivateStore: vi.fn(async (mutator: (draft: PrivateStoreV1) => void | PrivateStoreV1) => {
    const draft = structuredClone(store)
    store = (mutator(draft) as PrivateStoreV1 | undefined) || draft
    return structuredClone(store)
  }),
}))

import {
  loadAgentLocalHistory,
  loadAgentPersistedState,
  saveAgentLocalHistory,
  saveAgentPersistedState,
  type AgentChatMessage,
  type AgentSessionItem,
} from '../services/agent'

const message: AgentChatMessage = {
  id: 'message-id',
  role: 'user',
  content: 'private-content',
  status: 'done',
  tools: [],
  attachments: [],
  choices: [],
  createdAt: 1,
}

describe('智能助手 Private Vault 存储', () => {
  beforeEach(() => { store = { schema: 1 } })

  it('当前会话的 sessionId、消息 id 和 content 存入 Private Store', async () => {
    await saveAgentPersistedState('session-id', [message])
    expect(store.agent?.state).toEqual({ sessionId: 'session-id', messages: [message] })
    await expect(loadAgentPersistedState()).resolves.toEqual({ sessionId: 'session-id', messages: [message] })
  })

  it('历史的 clientSessionId、sessionId、消息 id 和 content 存入 Private Store', async () => {
    const session: AgentSessionItem = {
      sessionId: 'server-session-id',
      clientSessionId: 'client-session-id',
      title: '标题',
      updatedAt: 2,
      messages: [message],
    }
    await saveAgentLocalHistory([session])
    expect(JSON.stringify(store.agent?.history)).toContain('client-session-id')
    expect(JSON.stringify(store.agent?.history)).toContain('private-content')
    const loaded = await loadAgentLocalHistory()
    expect(loaded[0]?.sessionId).toBe('server-session-id')
    expect(loaded[0]?.clientSessionId).toBe('client-session-id')
    expect(loaded[0]?.messages?.[0]?.id).toBe('message-id')
    expect(loaded[0]?.messages?.[0]?.content).toBe('private-content')
  })
})
