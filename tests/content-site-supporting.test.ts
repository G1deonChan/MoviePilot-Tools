import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }))

vi.mock('../core/bus', () => ({
  MSG: { SITE_SUPPORTING_GET: 'SITE_SUPPORTING_GET' },
  sendMessage,
}))

import { fetchSupportingFromBackground } from '../content/site-supporting'

describe('内容脚本站点适配数据', () => {
  beforeEach(() => {
    sendMessage.mockReset()
  })

  it('只通过后台消息读取，不在页面上下文直连 MoviePilot', async () => {
    const supporting = { 'example.com': { id: 1, name: '示例站', domain: 'example.com' } }
    sendMessage.mockResolvedValue(supporting)

    await expect(fetchSupportingFromBackground()).resolves.toEqual(supporting)
    expect(sendMessage).toHaveBeenCalledWith('SITE_SUPPORTING_GET')
  })
})
