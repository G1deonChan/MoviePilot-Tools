<template>
  <div class="mp-login">
    <el-card class="mp-login-card" shadow="never">
      <img class="mp-login-brand" :src="logoUrl" alt="MoviePilot Tools" />
      <h2 class="mp-login-title">
        MoviePilot Tools <span class="mp-login-version">v{{ version }}</span>
      </h2>

      <!-- 快捷登录：有已保存账号且未进入重新登录时展示 -->
      <div v-if="showQuickLogin" class="mp-account-panel">
        <div class="mp-account-panel-head">
          <span class="mp-account-panel-title">
            <svg class="mp-account-panel-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path :d="mdiLightningBolt" />
            </svg>
            快捷登录
          </span>
          <span class="mp-account-panel-count">{{ accounts.length }}</span>
        </div>
        <p class="mp-account-panel-hint">点击账号即可登录</p>
        <div class="mp-account-scroll">
          <button
            v-for="acc in accounts"
            :key="acc.id"
            type="button"
            class="mp-account-item"
            :class="{ 'is-busy': switchingId === acc.id }"
            :disabled="!!switchingId"
            @click="onSwitch(acc.id)"
          >
            <span class="mp-account-avatar" :class="{ 'has-img': !!acc.avatar }">
              <img v-if="acc.avatar" :src="acc.avatar" alt="" />
              <span v-else>{{ letterOf(acc) }}</span>
            </span>
            <span class="mp-account-meta">
              <span class="mp-account-name-line">
                <span class="mp-account-name">{{ displayNameOf(acc) }}</span>
                <span class="mp-account-role-tags">
                  <el-tag v-if="acc.superUser" size="small" type="danger" effect="plain">管理员</el-tag>
                  <el-tag v-else size="small" type="info" effect="plain">普通用户</el-tag>
                </span>
              </span>
              <span class="mp-account-sub" :title="hostOf(acc.baseURL)">
                <span class="mp-account-host">{{ acc.serverName || hostOf(acc.baseURL) }}</span>
              </span>
            </span>
            <span v-if="switchingId === acc.id" class="mp-account-status">登录中</span>
            <span v-else class="mp-account-arrow" aria-hidden="true">›</span>
          </button>
        </div>
        <button
          type="button"
          class="mp-relogin-btn"
          :disabled="!!switchingId"
          @click="openRelogin"
        >
          重新登录
        </button>
      </div>

      <!-- 无已保存账号，或点击「重新登录」后显示表单 -->
      <template v-else>
        <div v-if="accounts.length" class="mp-form-head">
          <button type="button" class="mp-back-btn" :disabled="loading" @click="backToQuickLogin">
            <svg class="mp-back-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path :d="mdiChevronLeft" />
            </svg>
            返回快捷登录
          </button>
          <span class="mp-form-head-title">重新登录</span>
        </div>

        <el-form class="mp-login-form" :model="form" label-position="top" @submit.prevent>
          <el-form-item label="服务器地址" required>
            <el-input
              v-model="form.baseUrl"
              placeholder="https://your-mp.example.com"
              :prefix-icon="Link"
              clearable
              autocomplete="url"
            />
          </el-form-item>
          <el-form-item label="服务器名称" required>
            <el-input
              v-model="form.serverName"
              placeholder="自定义名称，用于区分不同服务器"
              :prefix-icon="Link"
              clearable
              maxlength="40"
            />
          </el-form-item>
          <div class="row-two">
            <el-form-item label="用户名" required class="half">
              <el-input
                v-model="form.username"
                :prefix-icon="User"
                clearable
                autocomplete="username"
              />
            </el-form-item>
            <el-form-item label="密码" required class="half">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                :prefix-icon="Lock"
                autocomplete="current-password"
              />
            </el-form-item>
          </div>
          <el-form-item label="两步验证码（可选）">
            <el-input
              v-model="form.otp"
              placeholder="6 位数字"
              maxlength="6"
              :prefix-icon="Key"
              @input="onOtpInput"
            />
          </el-form-item>
          <el-button type="primary" :loading="loading" class="mp-login-btn" @click="onSubmit">
            登录
          </el-button>
        </el-form>
      </template>

      <footer class="mp-login-footer">
        <span class="mp-login-footer-text">© 2026 MoviePilot-Tools · v{{ version }}</span>
      </footer>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, User, Lock, Key } from '@element-plus/icons-vue'
import { mdiLightningBolt, mdiChevronLeft } from '@mdi/js'
import {
  login,
  isLoggedIn,
  listAccounts,
  switchAccount,
  getBaseUrl,
  type MpAccountPublic,
} from '../services/auth'
import { hasPin } from '../services/credential'
import { getActiveLoginUsername } from '../core/auth-session'
import { maskBaseUrl } from '../utils/url'
import { appState } from '../core/state'

const emit = defineEmits<{ (e: 'logged-in'): void; (e: 'need-pin'): void }>()

const logoUrl = chrome.runtime.getURL('/icons/icon.png')
const version = __APP_VERSION__

function onOtpInput(val: string): void {
  form.otp = val.replace(/\D/g, '').slice(0, 6)
}

/** 列表仅展示脱敏地址，避免完整域名直出 */
function hostOf(url: string): string {
  return maskBaseUrl(url)
}

function letterOf(acc: MpAccountPublic): string {
  return (acc.userName || acc.username || '?').charAt(0).toUpperCase()
}

function displayNameOf(acc: MpAccountPublic): string {
  return acc.userName || acc.username || acc.label || '用户'
}

const form = reactive({ serverName: '', baseUrl: '', username: '', password: '', otp: '' })
const loading = ref(false)
const accounts = ref<MpAccountPublic[]>([])
const switchingId = ref<string | null>(null)
/** 有已保存账号时默认快捷登录；点「重新登录」后切到表单 */
const forceForm = ref(false)

const showQuickLogin = computed(() => accounts.value.length > 0 && !forceForm.value)

function openRelogin(): void {
  forceForm.value = true
  form.password = ''
  form.otp = ''
}

function backToQuickLogin(): void {
  forceForm.value = false
  form.password = ''
  form.otp = ''
}

async function afterAuthSuccess(name: string): Promise<void> {
  ElMessage.success(`欢迎回来，${name}`)
  if (await hasPin()) emit('need-pin')
  else emit('logged-in')
  void isLoggedIn()
}

onMounted(async () => {
  const preferForm = appState.preferLoginForm
  // 立即消费，避免再次进入登录页仍被强制表单
  appState.preferLoginForm = false

  const [baseUrl, username, accs] = await Promise.all([
    getBaseUrl(),
    getActiveLoginUsername(),
    listAccounts(),
  ])
  accounts.value = accs

  if (preferForm) {
    // 用户页「添加账号」：直接打开重新登录表单，表单留空便于录入新账号
    forceForm.value = true
    form.baseUrl = ''
    form.username = ''
    form.password = ''
    form.otp = ''
    return
  }

  if (baseUrl) form.baseUrl = baseUrl
  if (username) form.username = username
  // 无已保存账号时直接展示登录表单；有账号则默认快捷登录
  forceForm.value = accs.length === 0
})

async function onSwitch(id: string): Promise<void> {
  if (switchingId.value) return
  switchingId.value = id
  try {
    const res = await switchAccount(id)
    if (!res.success) {
      ElMessage.error(res.message ?? '登录失败')
      return
    }
    const acc = (await listAccounts()).find((a) => a.id === id)
    await afterAuthSuccess(acc?.userName || acc?.username || '用户')
  } finally {
    switchingId.value = null
  }
}

async function onSubmit(): Promise<void> {
  if (!form.serverName.trim()) {
    ElMessage.warning('请输入服务器名称')
    return
  }
  loading.value = true
  try {
    const res = await login(
      form.baseUrl,
      form.username,
      form.password,
      form.otp || undefined,
      form.serverName.trim(),
    )
    if (!res.success) {
      ElMessage.error(res.message ?? '登录失败')
      return
    }
    // login() 已加密投影 baseURL / 用户名；勿再明文写 BASE_URL
    await afterAuthSuccess(form.username)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.mp-login {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  /* 页面外层四边统一 */
  padding: 12px;
  box-sizing: border-box;
  min-height: 0;
  overflow: hidden;
}
.mp-login-card {
  width: 100%;
  max-width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  /* 表单页禁止滚动条；账号过多时仅列表区滚动 */
  overflow: hidden;
  background: transparent;
  border: none;
  box-sizing: border-box;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.mp-login-footer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  /* 页脚贴底，吃掉紫色空白区，而不是把表单往中间挤 */
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  text-align: center;
  user-select: none;
  white-space: nowrap;
}
.mp-login-footer-text {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #64748b;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}
.mp-login-card :deep(.el-card__body) {
  /* 内容靠上 + 页脚贴底，避免上下大块空白、表单被居中挤紧 */
  padding: 16px;
  margin: 0;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.mp-login-brand {
  display: block;
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  object-fit: contain;
  flex-shrink: 0;
}
.mp-login-title {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  margin: 0 0 14px;
  font-size: 18px;
  line-height: 1.3;
  color: var(--mp-color-text-strong, var(--mp-color-text));
  flex-shrink: 0;
}
.mp-login-version {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.mp-login-btn {
  width: 100%;
  margin-top: 4px;
  height: 36px;
  font-weight: 600;
}
.mp-login-form {
  flex: 0 1 auto;
  min-height: 0;
}
.mp-login-form :deep(.el-form-item) {
  margin-bottom: 12px;
}
.mp-login-form :deep(.el-form-item:last-of-type) {
  margin-bottom: 12px;
}
.mp-login-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px !important;
  line-height: 1.25;
  height: auto !important;
}
.mp-login-form :deep(.el-input__wrapper) {
  min-height: 34px;
  padding-top: 0;
  padding-bottom: 0;
}
.mp-login-form .row-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mp-login-form .row-two .half {
  min-width: 0;
}

/* ---- 快捷登录面板 ---- */
.mp-account-panel {
  margin: 0;
  padding: 12px;
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mp-account-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  padding: 0 2px;
}
.mp-account-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #0f172a;
  min-width: 0;
}
.mp-account-panel-icon {
  flex: 0 0 auto;
  display: block;
}
.mp-account-panel-icon path {
  fill: #1677ff;
}
.mp-account-panel-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.1);
  color: #1677ff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mp-account-panel-hint {
  margin: 0 0 10px;
  padding: 0 2px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
}
.mp-account-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 仅账号列表可滚，外层登录卡不出现滚动条 */
  max-height: min(180px, 34vh);
  overflow-x: hidden;
  overflow-y: auto;
  /* 预留上浮与阴影空间，避免首卡 hover 时顶边被裁切 */
  padding: 4px 4px 8px 2px;
  margin: -2px -2px 0 0;
  scrollbar-gutter: auto;
}
.mp-account-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  position: relative;
  z-index: 0;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease,
    z-index 0s;
}
.mp-account-item:hover:not(:disabled) {
  z-index: 2;
  border-color: rgba(22, 119, 255, 0.45);
  box-shadow:
    0 6px 14px rgba(22, 119, 255, 0.12),
    0 1px 0 rgba(255, 255, 255, 0.6) inset;
  transform: translateY(-2px);
}
.mp-account-item:disabled {
  cursor: wait;
}
.mp-account-item.is-busy {
  border-color: rgba(22, 119, 255, 0.35);
  background: rgba(22, 119, 255, 0.04);
}
.mp-account-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(145deg, #dbeafe, #e0e7ff);
  color: #3730a3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  flex: 0 0 auto;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
}
.mp-account-avatar.has-img {
  background: #f1f5f9;
}
.mp-account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mp-account-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mp-account-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mp-account-name {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-account-role-tags {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.mp-account-role-tags :deep(.el-tag) {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  border-radius: 4px;
}
.mp-account-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
}
.mp-account-host {
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-account-dot {
  opacity: 0.7;
}
.mp-account-status {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: #1677ff;
}
.mp-account-arrow {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.12);
}
.mp-account-item:hover:not(:disabled) .mp-account-arrow {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.12);
}
.mp-relogin-btn {
  width: 100%;
  margin-top: 12px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #fff;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.mp-relogin-btn:hover:not(:disabled) {
  border-color: rgba(22, 119, 255, 0.35);
  color: #1677ff;
  background: rgba(22, 119, 255, 0.04);
}
.mp-relogin-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ---- 重新登录表单头 ---- */
.mp-form-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-width: 0;
  flex-shrink: 0;
}
.mp-back-btn {
  border: none;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.mp-back-icon {
  flex: 0 0 auto;
  display: block;
  margin-left: -2px;
}
.mp-back-icon path {
  fill: currentColor;
}
.mp-back-btn:hover:not(:disabled) {
  color: #4096ff;
}
.mp-back-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mp-form-head-title {
  flex: 1 1 auto;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
}

.mp-login :deep(.el-input__wrapper) {
  box-shadow: none;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank, var(--mp-color-input-bg, #fff));
  transition:
    border-color 0.2s,
    background-color 0.2s;
}
.mp-login :deep(.el-input__wrapper:hover) {
  border-color: var(--el-border-color-hover);
}
.mp-login :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
}

/* 暗色主题：提亮快捷登录层级，避免 #0f172a 过黑 */
:global(html[data-theme='dark']) .mp-login-footer {
  border-top-color: rgba(148, 163, 184, 0.22) !important;
}
:global(html[data-theme='dark']) .mp-login-footer-text {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .mp-login-title {
  color: #f8fafc !important;
}
:global(html[data-theme='dark']) .mp-login-version {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .mp-login :deep(.el-input__wrapper) {
  background: #243447 !important;
  border-color: #475569 !important;
  box-shadow: none !important;
}
:global(html[data-theme='dark']) .mp-login :deep(.el-input__wrapper:hover) {
  border-color: #64748b !important;
}
:global(html[data-theme='dark']) .mp-login :deep(.el-input__wrapper.is-focus) {
  border-color: #60a5fa !important;
}
:global(html[data-theme='dark']) .mp-login :deep(.el-input__inner) {
  color: #f1f5f9 !important;
}
:global(html[data-theme='dark']) .mp-account-panel-icon path {
  fill: #93c5fd !important;
}
:global(html[data-theme='dark']) .mp-login-form :deep(.el-form-item__label) {
  color: #cbd5e1 !important;
}
:global(html[data-theme='dark']) .mp-account-panel {
  background: #273549 !important;
  border-color: #3d4f66 !important;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18) !important;
}
:global(html[data-theme='dark']) .mp-account-panel-title {
  color: #f8fafc !important;
}
:global(html[data-theme='dark']) .mp-account-panel-hint {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .mp-account-panel-count {
  background: rgba(96, 165, 250, 0.18) !important;
  color: #93c5fd !important;
}
:global(html[data-theme='dark']) .mp-account-item {
  background: #314358 !important;
  border-color: #45586f !important;
  box-shadow: none !important;
}
:global(html[data-theme='dark']) .mp-account-item:hover:not(:disabled) {
  border-color: rgba(96, 165, 250, 0.55) !important;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.28) !important;
  background: #3a5168 !important;
}
:global(html[data-theme='dark']) .mp-account-item.is-busy {
  background: rgba(59, 130, 246, 0.16) !important;
  border-color: rgba(96, 165, 250, 0.42) !important;
}
:global(html[data-theme='dark']) .mp-account-name {
  color: #f8fafc !important;
}
:global(html[data-theme='dark']) .mp-account-role-tags :deep(.el-tag--danger) {
  color: #fca5a5 !important;
  background: rgba(239, 68, 68, 0.18) !important;
  border-color: rgba(248, 113, 113, 0.28) !important;
}
:global(html[data-theme='dark']) .mp-account-role-tags :deep(.el-tag--info) {
  color: #cbd5e1 !important;
  background: rgba(148, 163, 184, 0.16) !important;
  border-color: rgba(148, 163, 184, 0.28) !important;
}
:global(html[data-theme='dark']) .mp-account-sub,
:global(html[data-theme='dark']) .mp-account-host {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .mp-account-status {
  color: #93c5fd !important;
}
:global(html[data-theme='dark']) .mp-account-avatar {
  background: linear-gradient(145deg, rgba(96, 165, 250, 0.34), rgba(129, 140, 248, 0.28)) !important;
  color: #dbeafe !important;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2) !important;
}
:global(html[data-theme='dark']) .mp-account-avatar.has-img {
  background: #243447 !important;
}
:global(html[data-theme='dark']) .mp-account-arrow {
  background: rgba(71, 85, 105, 0.9) !important;
  color: #cbd5e1 !important;
}
:global(html[data-theme='dark']) .mp-account-item:hover:not(:disabled) .mp-account-arrow {
  color: #93c5fd !important;
  background: rgba(59, 130, 246, 0.22) !important;
}
:global(html[data-theme='dark']) .mp-relogin-btn {
  background: #314358 !important;
  border-color: #45586f !important;
  color: #f1f5f9 !important;
}
:global(html[data-theme='dark']) .mp-relogin-btn:hover:not(:disabled) {
  border-color: rgba(96, 165, 250, 0.5) !important;
  color: #bfdbfe !important;
  background: rgba(59, 130, 246, 0.16) !important;
}
:global(html[data-theme='dark']) .mp-back-btn {
  color: #93c5fd !important;
}
:global(html[data-theme='dark']) .mp-back-btn:hover:not(:disabled) {
  color: #bfdbfe !important;
}
:global(html[data-theme='dark']) .mp-form-head-title {
  color: #cbd5e1 !important;
}
</style>
