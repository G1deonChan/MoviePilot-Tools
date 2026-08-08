import { defineContentScript } from 'wxt/sandbox'
import { handleContentMessages } from '../core/bus'
import { initPtFloat } from '../content/pt-float'
import { initMpBridge, tryEarlyMpEmbedGlass } from '../content/mp-bridge'
import { initCaptchaAutoFill } from '../content/captcha-auto-fill'
import { initPtCreds } from '../content/pt-creds'
import { initPageFilePicker } from '../content/page-file-picker'
import { isExtensionContextValid } from '../core/extension-context'

// Content Script 在全部框架运行。顶层框架挂载站点交互功能，子框架只运行 MoviePilot 鉴权与嵌入桥接。
const inTopFrame = window.self === window.top

export default defineContentScript({
  matches: ['<all_urls>'],
  // 子框架需要接收插件页鉴权、主题和外观消息。
  allFrames: true,
  // 在 MoviePilot 启动层绘制前建立嵌入底色。
  runAt: 'document_start',
  main() {
    if (!isExtensionContextValid()) return
    // 尽早设置 iframe 根底色，避免加载阶段短暂透出父窗口
    tryEarlyMpEmbedGlass()

    const boot = () => {
      if (!isExtensionContextValid()) return
      handleContentMessages(undefined)
      // 顶层框架挂载站点交互功能；子框架仅运行桥接。
      if (inTopFrame) {
        initPtFloat()
        initCaptchaAutoFill()
        initPtCreds()
        initPageFilePicker()
      }
      initMpBridge()
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true })
    } else {
      boot()
    }
  },
})
