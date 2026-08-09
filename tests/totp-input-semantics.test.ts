import { describe, expect, it } from 'vitest'
import {
  isImageCaptchaSemanticText,
  isTotpSemanticText,
  SEARCH_LIKE_KEYWORDS_REGEX,
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

describe('搜索/快捷定位输入框识别', () => {
  it('GitHub 顶部「转到文件」快捷搜索框被识别为搜索框（避免 TOTP 误识别）', () => {
    for (const text of [
      'prc-components-FileResultsList-ivWkTK FormControl-input 转到文件',
      'FormControl-input FormControl-placeholder-trigger Go to file',
      'FormControl-input FormControl-placeholder-trigger Go to file',
      'command_palette_search text',
    ]) {
      expect(SEARCH_LIKE_KEYWORDS_REGEX.test(text)).toBe(true)
    }
  })

  it('一般搜索/查询关键字仍命中', () => {
    for (const text of ['q', 'query', 'search', '搜索', '关键词']) {
      expect(SEARCH_LIKE_KEYWORDS_REGEX.test(text)).toBe(true)
    }
  })
})
