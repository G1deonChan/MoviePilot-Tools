import { describe, it, expect } from 'vitest'
import {
  normalizeBaseUrl,
  hostnameOf,
  isPrivateHost,
  maskHostname,
  maskBaseUrl,
} from '../utils/url'

describe('normalizeBaseUrl', () => {
  it('补全协议并去尾斜杠', () => {
    expect(normalizeBaseUrl('example.com')).toBe('https://example.com')
    expect(normalizeBaseUrl('http://a.com/')).toBe('http://a.com')
    expect(normalizeBaseUrl('https://a.com/path?q=1#h')).toBe('https://a.com')
  })
  it('空串返回空', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('hostnameOf', () => {
  it('去 www 前缀', () => {
    expect(hostnameOf('https://www.example.com/path')).toBe('example.com')
    expect(hostnameOf('https://sub.example.com')).toBe('sub.example.com')
  })
})

describe('isPrivateHost', () => {
  it('识别内网 IPv4、本地主机与单标签主机', () => {
    expect(isPrivateHost('http://192.168.1.10:3000')).toBe(true)
    expect(isPrivateHost('10.0.0.2')).toBe(true)
    expect(isPrivateHost('172.31.8.9')).toBe(true)
    expect(isPrivateHost('100.64.1.2')).toBe(true)
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('nas.local')).toBe(true)
    expect(isPrivateHost('my-nas')).toBe(true)
  })

  it('不把公网域名与公网 IP 标记为内网', () => {
    expect(isPrivateHost('https://example.com')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
  })
})

describe('maskBaseUrl', () => {
  it('保留协议与端口，仅子域脱敏、注册域明文', () => {
    expect(maskBaseUrl('https://movie.example.com:3000')).toBe('https://*.example.com:3000')
    expect(maskBaseUrl('http://example.com')).toBe('http://example.com')
    // 多级子域：仅子域掩码，注册域完整保留
    expect(maskHostname('a.b.example.com')).toBe('*.example.com')
    expect(maskHostname('mp.media.example.org')).toBe('*.example.org')
    // 两段后缀（com.cn / co.uk）保留最后两段
    expect(maskHostname('a.b.example.co.uk')).toBe('*.example.co.uk')
    // 单段主机不脱敏
    expect(maskHostname('localhost')).toBe('localhost')
  })
  it('IPv4 中间段脱敏', () => {
    expect(maskHostname('192.168.1.10')).toBe('192.***.***.10')
    expect(maskBaseUrl('https://192.168.1.10')).toBe('https://192.***.***.10')
  })
  it('空串安全', () => {
    expect(maskBaseUrl('')).toBe('')
  })
})
