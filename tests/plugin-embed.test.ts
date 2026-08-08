import { describe, expect, it } from 'vitest'
import {
  getPluginEmbedNonce,
  isPluginEmbedCandidate,
  isPluginRouteHash,
} from '../core/plugin-embed'

const nonce = '3b2b49a4d1dc4fa68ac928a7a1850321'
const pluginUrl = `https://mp.example.com/#/plugins?tab=installed&embed=1&embed_nonce=${nonce}`

describe('插件管理 iframe 门禁', () => {
  it('仅接受精确插件列表或插件详情路由', () => {
    expect(isPluginRouteHash('#/plugins?tab=installed')).toBe(true)
    expect(isPluginRouteHash('#/plugin/page/demo')).toBe(true)
    expect(isPluginRouteHash('#/plugin-tools')).toBe(false)
    expect(isPluginRouteHash('#/other/plugin')).toBe(false)
  })

  it('普通顶层页面和缺少嵌入参数的 iframe 均不成为候选', () => {
    expect(isPluginEmbedCandidate(pluginUrl, false)).toBe(false)
    expect(isPluginEmbedCandidate('https://example.com/#/plugin/page/demo', true)).toBe(false)
    expect(isPluginEmbedCandidate('https://example.com/#/plugin/page/demo?embed=1', true)).toBe(false)
  })

  it('拒绝过短或包含非法字符的 nonce', () => {
    expect(getPluginEmbedNonce('https://mp.example.com/#/plugins?embed=1&embed_nonce=short')).toBe('')
    expect(getPluginEmbedNonce('https://mp.example.com/#/plugins?embed=1&embed_nonce=invalid%20nonce%21')).toBe('')
  })

  it('合法插件 iframe 不依赖跨源 referrer 建立握手监听', () => {
    expect(isPluginEmbedCandidate(pluginUrl, true)).toBe(true)
  })
})
