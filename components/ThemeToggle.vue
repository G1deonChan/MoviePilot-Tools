<template>
  <el-tooltip :content="tip" placement="bottom">
    <button class="mp-theme-toggle" :aria-label="'切换主题'" @click="toggle">
      <el-icon :size="16"><component :is="iconComp" /></el-icon>
    </button>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Sunny, Moon, Monitor } from '@element-plus/icons-vue'
import { applyTheme, themeState, type ThemePref } from '../core/theme'

const ORDER: ThemePref[] = ['light', 'dark', 'auto']

/** 订阅共享的 `themeState.pref`，切换后立即更新图标。 */
const current = computed(() => themeState.pref)

const iconComp = computed(() =>
  current.value === 'dark' ? Moon : current.value === 'auto' ? Monitor : Sunny,
)
const tip = computed(() => {
  if (current.value === 'light') return '切换为深色'
  if (current.value === 'dark') return '切换为自动'
  return '切换为浅色'
})

function toggle(): void {
  const idx = ORDER.indexOf(current.value)
  const next = ORDER[(idx + 1) % ORDER.length]
  void applyTheme(next)
}
</script>

<style scoped>
.mp-theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--mp-radius-sm);
  color: var(--mp-color-text-secondary);
  cursor: pointer;
  transition:
    background 0.18s var(--mp-ease),
    color 0.18s var(--mp-ease),
    transform 0.18s var(--mp-ease);
}
.mp-theme-toggle:hover {
  background: var(--mp-color-hover);
  color: var(--mp-color-primary-soft, var(--mp-color-primary));
}

:global(html[data-theme='dark']) .mp-theme-toggle {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .mp-theme-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #60a5fa;
}
.mp-theme-toggle:active {
  transform: scale(0.92);
}
@media (prefers-reduced-motion: reduce) {
  .mp-theme-toggle {
    transition: none;
  }
  .mp-theme-toggle:active {
    transform: none;
  }
}
</style>
