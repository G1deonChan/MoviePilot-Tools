<template>
  <aside class="sidebar">
    <div class="logo" title="打开 Web 端" @click="openWeb">
      <img :src="logoUrl" alt="logo" />
    </div>
    <div class="menu">
      <button
        v-for="item in menuItems"
        :key="item.id"
        type="button"
        class="item"
        :class="{ active: current === item.id }"
        :title="item.label"
        @click="$emit('select', item.id)"
      >
        <svg viewBox="0 0 24 24">
          <path :d="item.icon" />
        </svg>
        <span class="item-label">{{ item.label }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { getActiveBaseUrl } from '../core/auth-session'
import {
  mdiWeb,
  mdiChartLine,
  mdiDownload,
  mdiShieldKey,
  mdiKeyOutline,
  mdiPuzzleOutline,
  mdiRobotOutline,
  mdiAccountCircle,
  mdiCogOutline,
  mdiInformationOutline,
} from '@mdi/js'

defineProps<{ current: string }>()
defineEmits<{ (e: 'select', key: string): void }>()

const logoUrl = chrome.runtime.getURL('/icons/icon.png')

const menuItems = [
  { id: 'sites', icon: mdiWeb, label: '站点管理' },
  { id: 'site-data', icon: mdiChartLine, label: '站点数据' },
  { id: 'downloads', icon: mdiDownload, label: '下载管理' },
  { id: 'totp', icon: mdiShieldKey, label: '两步验证' },
  { id: 'credentials', icon: mdiKeyOutline, label: '凭据管理' },
  { id: 'plugins', icon: mdiPuzzleOutline, label: '插件管理' },
  { id: 'agent', icon: mdiRobotOutline, label: '智能助手' },
  { id: 'user', icon: mdiAccountCircle, label: '用户信息' },
  { id: 'settings', icon: mdiCogOutline, label: '设置' },
  { id: 'about', icon: mdiInformationOutline, label: '关于' },
]

async function openWeb(): Promise<void> {
  const base = await getActiveBaseUrl()
  if (base) chrome.tabs?.create({ url: base })
}
</script>

<style scoped>
.sidebar {
  width: 48px;
  min-width: 48px;
  flex: 0 0 48px;
  height: 100%;
  background: var(--mp-color-surface, #fff);
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px;
  gap: 8px;
  box-sizing: border-box;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.logo img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  align-items: center;
}

.item {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  color: #606266;
  padding: 0;
}

.item svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
  color: inherit;
  transition: color 0.2s ease;
}

.item svg path {
  fill: currentColor;
}

.item.active {
  color: #1677ff;
}

.item.active svg {
  color: #1677ff;
}

.item:hover {
  transform: scale(1.1);
  background: transparent;
}

/* 活跃菜单项左侧指示条 */
.item::before {
  content: '';
  position: absolute;
  left: -6px;
  width: 3px;
  height: 18px;
  background: #1677ff;
  border-radius: 0 2px 2px 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  transition:
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.25s ease;
  opacity: 0;
  box-shadow: 0 0 8px rgba(22, 119, 255, 0.6);
}

.item.active::before {
  transform: translateY(-50%) scaleY(1);
  opacity: 1;
}

:global(html[data-theme='dark']) .sidebar {
  background: #1e293b !important;
  border-right-color: #334155 !important;
  color: #94a3b8;
}

/* 导航文字状态：未选 #94a3b8、悬停 #e2e8f0、选中 #60a5fa。 */
:global(html[data-theme='dark']) .item {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .item svg,
:global(html[data-theme='dark']) .item svg path {
  color: #94a3b8 !important;
  fill: #94a3b8 !important;
}

:global(html[data-theme='dark']) .item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .item:hover svg,
:global(html[data-theme='dark']) .item:hover svg path {
  color: #e2e8f0 !important;
  fill: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .item.active {
  color: #60a5fa !important;
  background: rgba(59, 130, 246, 0.15) !important;
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.25) !important;
}

:global(html[data-theme='dark']) .item.active svg,
:global(html[data-theme='dark']) .item.active svg path {
  color: #60a5fa !important;
  fill: #60a5fa !important;
}

:global(html[data-theme='dark']) .item.active:hover {
  background: rgba(59, 130, 246, 0.15) !important;
  color: #60a5fa !important;
}

:global(html[data-theme='dark']) .item.active:hover svg,
:global(html[data-theme='dark']) .item.active:hover svg path {
  color: #60a5fa !important;
  fill: #60a5fa !important;
}

:global(html[data-theme='dark']) .item.active::before {
  background: #60a5fa !important;
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.6) !important;
}

@media (prefers-reduced-motion: reduce) {
  .item {
    transition: none;
  }
  .item:hover {
    transform: none;
  }
  .item::before {
    transition: none;
  }
}
</style>
