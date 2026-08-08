import { describe, expect, it } from 'vitest'
import {
  ctcDecode,
  extractColorCaptchaText,
  suppressColorCaptchaNoise,
} from '../core/ocr-profiles'

describe('彩色干扰验证码预处理', () => {
  it('白化彩色块和噪点，同时保留黑色字符', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      45, 45, 45, 255,
      245, 120, 80, 255,
      90, 185, 225, 255,
      255, 255, 255, 255,
    ])

    const gray = suppressColorCaptchaNoise(rgba)

    expect(gray).not.toBeNull()
    expect(gray?.[0]).toBe(0)
    expect(gray?.[1]).toBe(0)
    expect(gray?.[2]).toBe(255)
    expect(gray?.[3]).toBe(255)
    expect(gray?.[4]).toBe(255)
  })

  it('保留低色差的灰色抗锯齿边缘并增强对比度', () => {
    const rgba = new Uint8ClampedArray([
      120, 124, 122, 255,
      210, 212, 211, 255,
      220, 80, 130, 255,
    ])

    const gray = suppressColorCaptchaNoise(rgba)

    expect(gray).not.toBeNull()
    expect(gray?.[0]).toBeGreaterThan(90)
    expect(gray?.[0]).toBeLessThan(140)
    expect(gray?.[1]).toBe(255)
    expect(gray?.[2]).toBe(255)
  })

  it('没有明显彩色干扰时不改变原灰度路径', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      90, 92, 91, 255,
      255, 255, 255, 255,
      200, 202, 201, 255,
    ])

    expect(suppressColorCaptchaNoise(rgba)).toBeNull()
  })

  it('全彩字符图片不会进入保黑去彩路径', () => {
    const rgba = new Uint8ClampedArray([
      180, 70, 220, 255,
      80, 190, 220, 255,
      240, 90, 160, 255,
      255, 255, 255, 255,
    ])

    expect(suppressColorCaptchaNoise(rgba)).toBeNull()
  })
})

describe('彩色字符细线验证码预处理', () => {
  it('将浅色字符转换为深色字形', () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255,
      180, 80, 220, 255,
      255, 255, 255, 255,
      80, 190, 220, 255,
      245, 225, 90, 255,
      255, 255, 255, 255,
    ])

    const gray = extractColorCaptchaText(rgba, 3, 2)

    expect(gray).not.toBeNull()
    expect(gray?.[0]).toBe(255)
    expect(gray?.[1]).toBeLessThan(100)
    expect(gray?.[3]).toBeLessThan(100)
    expect(gray?.[4]).toBeLessThan(180)
  })

  it('删除无纵向厚度的单像素横线并保留有纵向结构的字符', () => {
    const width = 5
    const height = 5
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = 255
    }
    const paint = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * width + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
    }
    for (let x = 0; x < width; x++) paint(x, 1, 80, 190, 220)
    paint(3, 2, 220, 80, 170)
    paint(3, 3, 220, 80, 170)
    paint(4, 3, 220, 80, 170)

    const gray = extractColorCaptchaText(rgba, width, height)

    expect(gray).not.toBeNull()
    expect(gray?.[1 * width + 1]).toBe(255)
    expect(gray?.[2 * width + 3]).toBeLessThan(255)
    expect(gray?.[3 * width + 3]).toBeLessThan(255)
  })
})

describe('OCR CTC 解码', () => {
  it('ddddocr 跳过 blank 和连续重复索引', () => {
    const labels = ['', 'A', 'B', '1']
    expect(ctcDecode('ddddocr', Int32Array.from([0, 1, 1, 0, 2, 3, 3]), [1, 7], labels)).toBe('AB1')
  })
})
