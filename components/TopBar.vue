<template>
  <header class="topbar" :style="{ '--topbar-icon-color': iconColor }">
    <div class="left">
      <svg v-if="icon" viewBox="0 0 24 24" class="title-icon">
        <path :d="icon" />
      </svg>
      <span class="title">{{ title }}</span>
    </div>
    <div class="right">
      <div v-if="serverName" class="server-indicator" :title="serverName">
        <span class="status-dot" />
        <span class="server-name">{{ serverName }}</span>
      </div>
      <ThemeToggle />
      <el-tooltip content="打开 Web 端" placement="bottom">
        <button type="button" class="web-btn" aria-label="打开 Web 端" @click="openWeb">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path :d="mdiOpenInNew" />
          </svg>
        </button>
      </el-tooltip>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { mdiOpenInNew } from '@mdi/js'
import { storage } from 'wxt/storage'
import ThemeToggle from './ThemeToggle.vue'
import { getActiveAccount } from '../services/auth'
import { getActiveBaseUrl } from '../core/auth-session'
import { STORE_KEYS } from '../core/store-repository'

withDefaults(
  defineProps<{
    title: string
    icon?: string
    iconColor?: string
  }>(),
  {
    icon: '',
    iconColor: '#34495e',
  },
)

const serverName = ref('')

async function refreshServerName(): Promise<void> {
  const account = await getActiveAccount()
  serverName.value = account?.serverName || ''
}

let stopWatch: (() => void) | undefined
onMounted(() => {
  void refreshServerName()
  stopWatch = storage.watch(STORE_KEYS.PRIVATE, () => {
    void refreshServerName()
  })
})
onUnmounted(() => stopWatch?.())

async function openWeb(): Promise<void> {
  const base = await getActiveBaseUrl()
  if (base) chrome.tabs?.create({ url: base })
}
</script>

<style scoped>
.topbar {
  height: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: var(--mp-color-surface, #ffffff);
  position: sticky;
  top: 0;
  z-index: 10;
  box-sizing: border-box;
}

.left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  font-weight: 600;
  font-size: 13px;
  color: #34495e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* 标题图标始终用页面品牌色，不随深色全局 svg 规则被刷成文字色 */
.title-icon {
  width: 16px;
  height: 16px;
  color: var(--topbar-icon-color, #34495e) !important;
  fill: currentColor !important;
  opacity: 0.9;
  flex-shrink: 0;
}

.title-icon path {
  fill: currentColor !important;
  stroke: none !important;
  color: inherit !important;
}

.web-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: #64748b;
  cursor: pointer;
  padding: 0;
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.web-btn svg {
  fill: currentColor;
}

.web-btn:hover {
  background: rgba(15, 23, 42, 0.05);
  color: #1677ff;
}

.server-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  min-width: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
  flex-shrink: 0;
}

.server-name {
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 深色顶栏使用 #1e293b 背景和 #e2e8f0 标题文字。 */
:global(html[data-theme='dark']) .topbar {
  background: #1e293b !important;
  border-bottom-color: #334155 !important;
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .title {
  color: #e2e8f0 !important;
}

/* 深色仅提高不透明度，颜色仍走品牌 --topbar-icon-color */
:global(html[data-theme='dark']) .title-icon {
  opacity: 0.95;
  color: var(--topbar-icon-color, #60a5fa) !important;
  fill: currentColor !important;
}

:global(html[data-theme='dark']) .title-icon path {
  fill: currentColor !important;
  stroke: none !important;
}

:global(html[data-theme='dark']) .web-btn {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .web-btn:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #60a5fa !important;
}

:global(html[data-theme='dark']) .web-btn svg {
  fill: currentColor;
}
::global(html[data-theme='dark']) .server-name {
  color: #94a3b8 !important;
}

::global(html[data-theme='dark']) .status-dot {
  background: #4ade80;
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.2);
}
</style>
