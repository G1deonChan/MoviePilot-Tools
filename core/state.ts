// 全局轻量状态（reactive，替代 Pinia；供 popup/多上下文共享）
import { reactive } from 'vue'
import type { UserInfo } from './types'

export const appState = reactive({
  currentView: 'sites' as string,
  loggedIn: false,
  unlocked: false,
  user: null as UserInfo | null,
  loading: false,
  /**
   * 下次进入登录页时优先展示「重新登录」表单（如用户页「添加账号」）。
   * LoginView 消费后应立即清 false。
   */
  preferLoginForm: false,
})

export type AppState = typeof appState
