import { describe, expect, it, vi } from 'vitest'
import {
  captureCaptchaImage,
  normalizeTransparentCaptchaPixels,
} from '../content/captcha-image'

function createImage(width: number, height: number): HTMLImageElement {
  return {
    complete: true,
    naturalWidth: width,
    naturalHeight: height,
    width,
    height,
    clientWidth: width,
    clientHeight: height,
  } as HTMLImageElement
}

describe('验证码当前图片像素读取', () => {
  it('透明验证码按 Alpha 转为黑字白底，不受浅色字符颜色影响', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,
      255, 240, 220, 255,
      80, 220, 210, 128,
      0, 0, 0, 0,
    ])

    expect(normalizeTransparentCaptchaPixels(pixels)).toBe(true)
    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      127, 127, 127, 255,
      255, 255, 255, 255,
    ])
  })

  it('完全不透明图片不应用 Alpha 字形归一化', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      240, 230, 220, 255,
    ])

    expect(normalizeTransparentCaptchaPixels(pixels)).toBe(false)
    expect(Array.from(pixels)).toEqual([
      10, 20, 30, 255,
      240, 230, 220, 255,
    ])
  })

  it('放大小图并对透明像素执行归一化', async () => {
    const imageData = {
      data: new Uint8ClampedArray([
        0, 0, 0, 0,
        255, 160, 160, 255,
      ]),
    } as ImageData
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      globalCompositeOperation: 'source-over',
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,current-pixels'),
    } as unknown as HTMLCanvasElement

    const result = await captureCaptchaImage(createImage(120, 40), {
      createCanvas: () => canvas,
    })

    expect(result).toBe('data:image/png;base64,current-pixels')
    expect(canvas.width).toBe(360)
    expect(canvas.height).toBe(120)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 360, 120)
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.putImageData).toHaveBeenCalledWith(imageData, 0, 0)
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('普通图片保持白底合成', async () => {
    const imageData = {
      data: new Uint8ClampedArray([
        40, 80, 120, 255,
        220, 200, 180, 255,
      ]),
    } as ImageData
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      globalCompositeOperation: 'source-over',
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,opaque-pixels'),
    } as unknown as HTMLCanvasElement

    await captureCaptchaImage(createImage(200, 60), { createCanvas: () => canvas })

    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 400, 120)
    expect(context.putImageData).not.toHaveBeenCalled()
    expect(context.globalCompositeOperation).toBe('source-over')
  })

  it('不调用 fetch 或读取图片 URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = {
      imageSmoothingEnabled: false,
      fillStyle: '',
      globalCompositeOperation: 'source-over',
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      } as ImageData)),
      putImageData: vi.fn(),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,pixels'),
    } as unknown as HTMLCanvasElement
    const image = createImage(200, 60)
    image.src = 'https://site.test/login_image.php'

    await captureCaptchaImage(image, { createCanvas: () => canvas })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('拒绝无尺寸图片', async () => {
    await expect(
      captureCaptchaImage(createImage(0, 0), {
        createCanvas: () => ({}) as HTMLCanvasElement,
      }),
    ).rejects.toThrow('验证码图片尺寸无效')
  })
})
