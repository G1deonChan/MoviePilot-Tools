import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatSize,
  formatTime,
  stablePaletteValue,
} from '../utils/format'

describe('formatSize', () => {
  it('零与负值', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(-1)).toBe('0 B')
  })
  it('各量级', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

describe('formatNumber', () => {
  it('千分位', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })
})

describe('formatTime', () => {
  it('零返回占位', () => {
    expect(formatTime(0)).toBe('-')
  })
  it('格式符合 YYYY-MM-DD HH:mm', () => {
    expect(formatTime(1700000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('页面格式化纯函数', () => {
  it('文件大小最多保留两位小数', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('日期时间保留原有输出和无效值行为', () => {
    expect(formatDateTime()).toBe('')
    expect(formatDateTime('invalid')).toBe('invalid')
    expect(formatDateTime('2026-07-23T08:09:00')).toMatch(/^2026-07-23 08:09$/)
  })

  it('日期格式保留未知和无效值行为', () => {
    expect(formatDate()).toBe('未知')
    expect(formatDate('invalid')).toBe('invalid')
    expect(formatDate('2026-07-23T08:09:00')).toMatch(/2026/)
  })

  it('相同字符串稳定选择同一项', () => {
    const palette = ['a', 'b', 'c'] as const
    expect(stablePaletteValue('example', palette)).toBe(stablePaletteValue('example', palette))
    expect(palette).toContain(stablePaletteValue('example', palette))
  })
})
