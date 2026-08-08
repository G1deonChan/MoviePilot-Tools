<template>
  <div class="pl-iframe-wrap">
    <el-alert
      v-if="!baseUrl"
      class="pl-tip"
      type="warning"
      :closable="false"
      show-icon
      title="未配置服务器地址，无法加载插件管理"
    />
    <template v-else>
      <div
        v-if="!iframeReady"
        class="pl-loading-surface"
        :class="{ 'has-background': currentAppearance.background.enabled }"
        :style="{ backgroundColor: loadingBaseColor }"
      >
        <div
          v-if="currentAppearance.background.enabled"
          class="pl-loading-background"
          :style="loadingBackgroundStyle"
        />
      </div>
      <iframe
        ref="iframeRef"
        :src="iframeUrl"
        class="pl-iframe"
        :class="{ 'is-ready': iframeReady }"
        @load="onIframeLoad"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// 插件管理：内嵌 MoviePilot 原生插件页。自定义背景在 iframe 内固定绘制，
// iframe 始终输出不透明表面，避免跨 frame Alpha 合成导致滚动渐进卡顿。
import { computed, ref, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { STORAGE_KEYS, storageGet, watchStorage } from '../core/storage'
import { getToken, getUserInfo } from '../services/auth'
import { getCustomBgImage } from '../core/theme'


import { getActiveBaseUrl } from '../core/auth-session'
import { currentTheme, DEFAULT_CUSTOM_BG_CONFIG, type CustomBgConfig } from '../core/theme'


interface EmbedAppearance {
  theme: 'light' | 'dark'
  background: {
    enabled: boolean
    image: string
    opacity: number
    blurEnabled: boolean
    blur: number
  }
}

const iframeRef = ref<HTMLIFrameElement | null>(null)
const baseUrl = ref('')
const iframeUrl = ref('')
const embedNonce = crypto.randomUUID().replaceAll('-', '')
const appearanceReady = ref(false)
const authReady = ref(false)
const iframeReady = computed(() => appearanceReady.value && authReady.value)
const currentAppearance = ref<EmbedAppearance>({
  theme: 'light',
  background: {
    enabled: false,
    image: '',
    opacity: DEFAULT_CUSTOM_BG_CONFIG.opacity,
    blurEnabled: DEFAULT_CUSTOM_BG_CONFIG.blurEnabled,
    blur: DEFAULT_CUSTOM_BG_CONFIG.blur,
  },
})

const loadingBaseColor = computed(() =>
  currentAppearance.value.theme === 'dark' ? '#121212' : '#f4f7fb',
)
const loadingBackgroundStyle = computed<CSSProperties>(() => ({
  backgroundImage: `url("${currentAppearance.value.background.image}")`,
  filter: currentAppearance.value.background.blurEnabled
    ? `blur(${currentAppearance.value.background.blur}px)`
    : 'none',
  opacity: currentAppearance.value.background.opacity,
}))

function themeName(): 'light' | 'dark' {
  return currentTheme() === 'dark' ? 'dark' : 'light'
}

function buildUrl(): string {
  const params = new URLSearchParams({
    tab: 'installed',
    theme: themeName(),
    embed: '1',
    embed_nonce: embedNonce,
  })
  return `${baseUrl.value}/#/plugins?${params}`
}

function getMoviePilotOrigin(): string {
  try {
    return new URL(baseUrl.value).origin
  } catch {
    return ''
  }
}

function post(target: Window | null | undefined, msg: Record<string, unknown>): void {
  const targetOrigin = getMoviePilotOrigin()
  if (!target || !targetOrigin) return
  try {
    target.postMessage({ ...msg, embedNonce }, targetOrigin)
  } catch {
    /* 跨域或窗口已销毁时静默忽略 */
  }
}

function sendTheme(): void {
  post(iframeRef.value?.contentWindow, { type: 'MP_THEME_CHANGE', theme: themeName() })
}

async function loadAppearance(): Promise<EmbedAppearance> {
  const [storedConfig, image] = await Promise.all([
    storageGet<Partial<CustomBgConfig>>(STORAGE_KEYS.CUSTOM_BG_CONFIG),
    getCustomBgImage(),

  ])
  const config = { ...DEFAULT_CUSTOM_BG_CONFIG, ...(storedConfig ?? {}) }
  const theme = themeName()
  return {
    theme,
    background: {
      enabled: theme !== 'dark' && config.enabled && !!image,
      image: image || '',
      opacity: config.opacity,
      blurEnabled: config.blurEnabled,
      blur: config.blur,
    },
  }
}

async function sendAppearance(): Promise<void> {
  const appearance = await loadAppearance()
  currentAppearance.value = appearance
  post(iframeRef.value?.contentWindow, {
    type: 'MP_IFRAME_SET_APPEARANCE',
    appearance,
  })
}

// 把扩展存储的 mp_token + 用户档案注入 MP 页面，实现 iframe 自动登录（免密、无需保存密码）
async function sendAuth(): Promise<void> {
  const token = await getToken()

  if (!token) {
    authReady.value = true
    return
  }
  const user = await getUserInfo()

  post(iframeRef.value?.contentWindow, { type: 'MP_IFRAME_AUTH', token, user: user ?? null })
}

function onIframeLoad(): void {
  appearanceReady.value = false
  authReady.value = false
  sendTheme()
  void sendAppearance()
  void sendAuth()
}

// 弹窗关闭时通知 iframe 清理扩展注入的 MP 登录态，避免污染浏览器内 MP Web 端
function sendLogout(): void {
  post(iframeRef.value?.contentWindow, { type: 'MP_IFRAME_LOGOUT' })
}

function isCurrentIframeMessage(event: MessageEvent): boolean {
  return (
    event.source === iframeRef.value?.contentWindow &&
    event.origin === getMoviePilotOrigin()
  )
}

function onMessage(event: MessageEvent): void {
  if (!isCurrentIframeMessage(event)) return
  const data = event.data as { type?: string; embedNonce?: string } | null
  if (!data?.type || data.embedNonce !== embedNonce) return
  if (data.type === 'MP_IFRAME_NEED_AUTH') {
    void sendAuth()
  } else if (data.type === 'MP_IFRAME_NEED_THEME') {
    sendTheme()
  } else if (data.type === 'MP_IFRAME_NEED_APPEARANCE') {
    void sendAppearance()
  } else if (data.type === 'MP_IFRAME_APPEARANCE_READY') {
    appearanceReady.value = true
  } else if (data.type === 'MP_IFRAME_AUTH_READY') {
    authReady.value = true
  }
}

async function load(): Promise<void> {
  const base = (await getActiveBaseUrl()) || ''
  if (!base) {
    baseUrl.value = ''
    return
  }
  currentAppearance.value = await loadAppearance()
  baseUrl.value = base
  iframeUrl.value = buildUrl()
}

const unsubs = [
  watchStorage<string>(STORAGE_KEYS.THEME, () => {
    sendTheme()
    void sendAppearance()
  }),

  watchStorage(STORAGE_KEYS.CUSTOM_BG_CONFIG, () => {
    void sendAppearance()
  }),
]

onMounted(() => {
  void load()
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', sendLogout)
  window.addEventListener('beforeunload', sendLogout)
})
onUnmounted(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('pagehide', sendLogout)
  window.removeEventListener('beforeunload', sendLogout)
  unsubs.forEach((u) => u())
})
</script>

<style scoped>
.pl-iframe-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #f4f7fb;
}
.pl-tip {
  margin: 12px;
}
.pl-loading-surface,
.pl-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pl-loading-surface {
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
}
.pl-loading-surface.has-background::after {
  position: absolute;
  inset: 0;
  background: rgba(246, 249, 255, 0.15);
  content: '';
}
.pl-loading-background {
  position: absolute;
  inset: -24px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.pl-iframe {
  z-index: 1;
  display: block;
  border: 0;
  background: #f4f7fb;
  color-scheme: light dark;
  opacity: 0;
}
.pl-iframe.is-ready {
  opacity: 1;
}
</style>
