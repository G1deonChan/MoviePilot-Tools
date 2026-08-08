import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '../../styles/reset.css'
import '../../styles/theme/tokens.css'
import '../../styles/theme/element-dark.css'
import '../../styles/theme/shell-dark.css'
import '../../styles/theme/custom-bg.css'
import '../../styles/message-box.css'
import '../../styles/mobile.css'
import AppShell from '../../components/AppShell.vue'

const ROOT_MODE_CLASSES = ['mobile-root', 'pc-root'] as const

function isMobileDevice(): boolean {
  const mobileUserAgent =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      navigator.userAgent,
    )
  const ipadDesktopMode = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  return mobileUserAgent || ipadDesktopMode
}

function applyRootMode(): void {
  const mode = isMobileDevice() ? 'mobile-root' : 'pc-root'
  for (const target of [document.documentElement, document.body]) {
    target.classList.remove(...ROOT_MODE_CLASSES)
    target.classList.add(mode)
  }
}

applyRootMode()
window.addEventListener('resize', applyRootMode, { passive: true })

// 完整注册 Element Plus，确保所有组件与 ElMessage/ElMessageBox 在压缩构建下均可用，
// 避免按需插件（unplugin-auto-import / unplugin-vue-components）在 tree-shaking 下把组件摇成 undefined。
createApp(AppShell).use(ElementPlus).mount('#app')
