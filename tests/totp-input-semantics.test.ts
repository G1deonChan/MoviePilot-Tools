import { describe, expect, it } from 'vitest'
import {
  isImageCaptchaSemanticText,
  isTotpSemanticText,
} from '../content/captcha-auto-fill'

describe('两步验证输入框语义分类', () => {
  it('示例站“请输入二步验证码”识别为 TOTP，不识别为图片验证码', () => {
    const text = 'form_item__2fa ant-input 请输入二步验证码'

    expect(isTotpSemanticText(text)).toBe(true)
    expect(isImageCaptchaSemanticText(text)).toBe(false)
  })

  it('简繁两步验证语义均优先于通用验证码词', () => {
    for (const text of [
      '请输入两步验证码',
      '請輸入兩步驗證碼',
      '双因素验证码',
      '雙因素驗證碼',
      '动态验证码',
      '動態驗證碼',
    ]) {
      expect(isTotpSemanticText(text)).toBe(true)
      expect(isImageCaptchaSemanticText(text)).toBe(false)
    }
  })

  it('普通图形验证码仍归类为图片验证码', () => {
    for (const text of [
      '请输入验证码',
      '請輸入驗證碼',
      '图形验证码',
      '圖片驗證碼',
      'captcha verify_code',
    ]) {
      expect(isImageCaptchaSemanticText(text)).toBe(true)
    }
  })
})
