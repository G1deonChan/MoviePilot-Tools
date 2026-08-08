<template>
  <div class="pin-lock-page">
    <div class="pin-lock-card">
      <div class="pin-brand">
        <img :src="logoUrl" alt="MoviePilot Tools" />
        <div class="pin-title">PIN 安全验证</div>
        <div class="pin-subtitle">请输入 6 位 PIN 以打开 MoviePilot Tools</div>
      </div>

      <div class="pin-form">
        <PinInput ref="pinInputRef" v-model="pin" @enter="onSubmit" @complete="onComplete" />
        <el-button
          type="primary"
          :loading="loading"
          class="pin-unlock-btn"
          @click="onSubmit"
        >
          解锁
        </el-button>
        <el-alert
          v-if="error"
          :title="error"
          type="error"
          show-icon
          :closable="false"
          class="pin-error"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import PinInput from '../components/PinInput.vue'
import { unlock } from '../services/credential'

const emit = defineEmits<{ (e: 'unlocked'): void }>()

const logoUrl = chrome.runtime.getURL('/icons/icon.png')
const pinInputRef = ref<{ focus: () => void } | null>(null)
const pin = ref('')
const loading = ref(false)
const error = ref('')

onMounted(() => {
  nextTick(() => pinInputRef.value?.focus())
})

async function onSubmit(): Promise<void> {
  if (loading.value) return
  if (pin.value.length < 6) {
    error.value = '请输入 6 位 PIN'
    return
  }

  loading.value = true
  error.value = ''
  const ok = await unlock(pin.value)
  loading.value = false

  if (!ok) {
    error.value = 'PIN 错误，请重试'
    pin.value = ''
    nextTick(() => pinInputRef.value?.focus())
    return
  }

  emit('unlocked')
}

function onComplete(): void {
  // 输满 6 位后自动尝试解锁，减少一次点击
  void onSubmit()
}
</script>

<style scoped>
.pin-lock-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
  background:
    radial-gradient(circle at top, rgba(59, 130, 246, 0.14), transparent 34%),
    linear-gradient(180deg, #f6f9ff 0%, #ffffff 100%);
}

.pin-lock-card {
  width: 100%;
  max-width: 352px;
  margin: 0;
  padding: 20px 18px 18px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  box-sizing: border-box;
}

.pin-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
}

.pin-brand img {
  width: 58px;
  height: 58px;
  object-fit: contain;
}

.pin-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--mp-color-text, #0f172a);
  line-height: 1.3;
}

.pin-subtitle {
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

.pin-form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pin-form :deep(.pin-code-inputs) {
  margin: 0 auto 4px;
  padding: 4px 0;
}

.pin-unlock-btn {
  width: 100%;
  margin-top: 14px;
  height: 40px;
  border-radius: 10px;
}

.pin-error {
  margin-top: 10px;
}

/* 深色主题（!important 覆盖浅色硬编码渐变） */
:global(html[data-theme='dark']) .pin-lock-page {
  background:
    radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 34%),
    #0f172a !important;
}

:global(html[data-theme='dark']) .pin-lock-card {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35) !important;
}

:global(html[data-theme='dark']) .pin-title {
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .pin-subtitle {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .pin-unlock-btn {
  --el-button-bg-color: #2563eb;
  --el-button-border-color: #2563eb;
  --el-button-text-color: #ffffff;
  --el-button-hover-bg-color: #1d4ed8;
  --el-button-hover-border-color: #1d4ed8;
  background: #2563eb !important;
  border-color: #2563eb !important;
  color: #fff !important;
}

:global(html[data-theme='dark']) .pin-error :deep(.el-alert) {
  background: rgba(239, 68, 68, 0.12) !important;
  border-color: rgba(239, 68, 68, 0.28) !important;
}

:global(html[data-theme='dark']) .pin-error :deep(.el-alert__title) {
  color: #fca5a5 !important;
}

/*
 * 自定义背景下的 PIN 玻璃卡片由 `styles/theme/custom-bg.css` 统一控制。
 * 切勿在本组件 scoped 中写 :global(.mp-app.has-custom-bg) .xxx：
 * Vue 会错误编译成 .mp-app.has-custom-bg { border/backdrop... }，给整个弹窗根节点套上白边。
 */
</style>
