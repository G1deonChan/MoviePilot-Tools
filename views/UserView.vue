<template>
  <div class="user-root">
    <template v-if="loading">
      <!-- 页面依次显示用户卡、账号管理和综合信息。 -->
      <div class="user-loading-card">
        <div class="user-loading-profile">
          <div class="user-loading-avatar user-loading-shimmer"></div>
          <div class="user-loading-meta">
            <div class="user-loading-name-line">
              <div class="user-loading-line name user-loading-shimmer"></div>
              <div class="user-loading-edit user-loading-shimmer"></div>
              <div class="user-loading-spacer"></div>
              <div class="user-loading-button user-loading-shimmer"></div>
            </div>
            <div class="user-loading-badges">
              <div class="user-loading-badge user-loading-shimmer"></div>
              <div class="user-loading-badge user-loading-shimmer"></div>
            </div>
          </div>
        </div>
        <div class="user-loading-divider"></div>
        <div class="user-loading-email-row">
          <div class="user-loading-email user-loading-shimmer"></div>
          <div class="user-loading-perm-tags">
            <div class="user-loading-perm user-loading-shimmer"></div>
            <div class="user-loading-perm user-loading-shimmer"></div>
          </div>
        </div>
        <div class="user-loading-sub-stats">
          <div class="user-loading-sub-stat">
            <div class="user-loading-icon user-loading-shimmer"></div>
            <div class="user-loading-sub-text">
              <div class="user-loading-line count user-loading-shimmer"></div>
              <div class="user-loading-line label user-loading-shimmer"></div>
            </div>
          </div>
          <div class="user-loading-sub-stat">
            <div class="user-loading-icon user-loading-shimmer"></div>
            <div class="user-loading-sub-text">
              <div class="user-loading-line count user-loading-shimmer"></div>
              <div class="user-loading-line label user-loading-shimmer"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="user-loading-account-card">
        <div class="user-loading-account-head">
          <div class="user-loading-account-title-wrap">
            <div class="user-loading-line account-title user-loading-shimmer"></div>
            <div class="user-loading-account-count user-loading-shimmer"></div>
          </div>
          <div class="user-loading-account-add user-loading-shimmer"></div>
        </div>
        <div class="user-loading-account-list">
          <div v-for="item in 2" :key="`acc-${item}`" class="user-loading-account-row">
            <div class="user-loading-account-avatar user-loading-shimmer"></div>
            <div class="user-loading-account-meta">
              <div class="user-loading-account-name-line">
                <div class="user-loading-line account-name user-loading-shimmer"></div>
                <div class="user-loading-account-tag user-loading-shimmer"></div>
              </div>
              <div class="user-loading-line account-sub user-loading-shimmer"></div>
            </div>
            <div class="user-loading-account-actions">
              <div class="user-loading-account-dot user-loading-shimmer"></div>
              <div class="user-loading-account-action user-loading-shimmer"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="user-loading-info-card">
        <div class="user-loading-stats-grid">
          <div v-for="item in 4" :key="item" class="user-loading-stat">
            <div class="user-loading-line stat-num user-loading-shimmer"></div>
            <div class="user-loading-line stat-label user-loading-shimmer"></div>
          </div>
        </div>
        <div class="user-loading-divider"></div>
        <div class="user-loading-version-title user-loading-shimmer"></div>
        <div class="user-loading-version-list">
          <div v-for="item in 4" :key="`v-${item}`" class="user-loading-version-item">
            <div class="user-loading-line version-label user-loading-shimmer"></div>
            <div class="user-loading-line version-value user-loading-shimmer"></div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="user-card">
        <div class="top">
          <div class="left">
            <div class="avatar-box">
              <div v-if="user?.is_superuser" class="crown">
                <svg viewBox="0 0 24 24" width="20" height="20"><path :d="mdiCrown" /></svg>
              </div>
              <el-avatar :size="56" :src="user?.avatar || ''" shape="square" class="avatar-squared">
                {{ initials }}
              </el-avatar>
            </div>
            <div class="meta">
              <div class="name-line">
                <div class="name">{{ displayName }}</div>
                <el-button link class="edit" title="编辑" @click="openEdit">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiPencil" /></svg>
                </el-button>
                <div class="spacer"></div>
                <button type="button" class="logout-btn" title="注销" @click="onLogout">
                  <svg viewBox="0 0 24 24" width="16" height="16" class="power"><path :d="mdiPowerStandby" /></svg>
                  <span>注销</span>
                </button>
              </div>
              <div class="badges">
                <el-tag v-if="user?.is_superuser" size="small" type="danger" effect="plain">管理员</el-tag>
                <el-tag v-else size="small" type="info" effect="plain">普通用户</el-tag>
                <el-tag v-if="user?.is_active !== false" size="small" type="success" effect="plain">激活</el-tag>
              </div>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="email-row">
          <div class="email">
            <svg viewBox="0 0 24 24" width="16" height="16" class="mail"><path :d="mdiEmailOutline" /></svg>
            <span>{{ user?.email || '未填写邮箱' }}</span>
          </div>
          <!-- 普通用户：仅展示已启用权限分类标签 -->
          <div v-if="showPermissionSection && enabledPermissionTags.length" class="perm-tags">
            <span
              v-for="tag in enabledPermissionTags"
              :key="tag.key"
              class="perm-tag"
              :class="`perm-tag--${tag.key}`"
              :title="tag.desc"
            >
              {{ tag.label }}
            </span>
          </div>
        </div>

        <div class="sub-stats">
          <div class="stat-row movie">
            <span class="bubble">
              <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiMovieOutline" /></svg>
            </span>
            <div class="stat-text">
              <div class="num">{{ movieCount }}</div>
              <div class="label">电影订阅</div>
            </div>
          </div>
          <div class="stat-row tv">
            <span class="bubble">
              <svg viewBox="0 0 24 24" width="16" height="16"><path :d="mdiTelevisionClassic" /></svg>
            </span>
            <div class="stat-text">
              <div class="num">{{ tvCount }}</div>
              <div class="label">剧集订阅</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 多账号：切换 / 添加 / 移除 -->
      <div v-if="accounts.length" class="account-card">
        <div class="account-card-head">
          <div class="account-card-title-wrap">
            <span class="account-card-title">账号管理</span>
            <span class="account-card-count">{{ accounts.length }}</span>
          </div>
          <button type="button" class="account-add-btn" @click="onAddAccount">
            <span class="account-add-plus">+</span>
            添加账号
          </button>
        </div>
        <div class="account-list">
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="account-row"
            :class="{
              active: acc.isActive,
              busy: switchingId === acc.id,
            }"
          >
            <button
              type="button"
              class="account-main"
              :disabled="acc.isActive || !!switchingId"
              :title="acc.isActive ? '当前账号' : '切换到此账号'"
              @click="onSwitchAccount(acc.id)"
            >
              <span class="account-avatar" :class="{ 'has-img': !!acc.avatar }">
                <img v-if="acc.avatar" :src="acc.avatar" alt="" />
                <span v-else>{{ (acc.userName || acc.username || '?').charAt(0).toUpperCase() }}</span>
              </span>
              <span class="account-meta">
                <span class="account-name-line">
                  <span class="account-name">{{ acc.userName || acc.username || acc.label }}</span>
                  <span class="account-role-tags">
                    <el-tag v-if="acc.superUser" size="small" type="danger" effect="plain">管理员</el-tag>
                    <el-tag v-else size="small" type="info" effect="plain">普通用户</el-tag>
                  </span>
                </span>
                <span class="account-sub" :title="hostOf(acc.baseURL)">
                  {{ acc.serverName || hostOf(acc.baseURL) }}
                </span>
              </span>
            </button>
            <div class="account-actions">
              <span
                v-if="acc.isActive"
                class="account-status-dot"
                title="当前账号"
                aria-label="当前账号"
              />
              <button
                v-else
                type="button"
                class="account-switch"
                :class="{ busy: switchingId === acc.id }"
                :title="switchingId === acc.id ? '切换中' : '切换到此账号'"
                :disabled="!!switchingId"
                @click="onSwitchAccount(acc.id)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path :d="mdiSwapHorizontal" />
                </svg>
              </button>
              <button
                type="button"
                class="account-remove"
                title="删除此账号"
                :disabled="removingId === acc.id || !!switchingId"
                @click="onRemoveAccount(acc)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path :d="mdiDelete" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="comprehensive-info">
        <div class="comprehensive-card">
          <div class="stats-section">
            <div class="stats-grid">
              <div class="stat-item stat-supporting">
                <div class="stat-num">{{ stats.supportingSites }}</div>
                <div class="stat-label">已适配站点</div>
              </div>
              <div class="stat-item stat-config">
                <div class="stat-num">{{ stats.configSites }}</div>
                <div class="stat-label">已配置站点</div>
              </div>
              <div class="stat-item stat-cookie">
                <div class="stat-num">{{ stats.cookieCount }}</div>
                <div class="stat-label">Cookie数</div>
              </div>
              <div class="stat-item stat-pending">
                <div class="stat-num">{{ stats.pending }}</div>
                <div class="stat-label">待更新</div>
              </div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="version-section">
            <div class="version-title">MoviePilot 版本信息</div>
            <div class="version-list">
              <div class="version-item">
                <span class="version-label">软件版本：</span>
                <span
                  class="version-value"
                  :class="{ 'is-outdated': systemVersionDisplay.outdated }"
                  :title="systemVersionDisplay.outdated ? '当前非最新版本' : undefined"
                >
                  <template v-if="systemVersionDisplay.outdated">
                    <span class="version-current">{{ systemVersionDisplay.current }}</span>
                    <span class="version-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="12" height="12">
                        <path
                          d="M3 8h8M8 4.5 11.5 8 8 11.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <span class="version-latest">{{ systemVersionDisplay.latest }}</span>
                  </template>
                  <template v-else>{{ systemVersionDisplay.text }}</template>
                </span>
              </div>
              <div class="version-item">
                <span class="version-label">前端版本：</span>
                <span
                  class="version-value"
                  :class="{ 'is-outdated': frontendVersionDisplay.outdated }"
                  :title="frontendVersionDisplay.outdated ? '当前非最新版本' : undefined"
                >
                  <template v-if="frontendVersionDisplay.outdated">
                    <span class="version-current">{{ frontendVersionDisplay.current }}</span>
                    <span class="version-arrow" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="12" height="12">
                        <path
                          d="M3 8h8M8 4.5 11.5 8 8 11.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <span class="version-latest">{{ frontendVersionDisplay.latest }}</span>
                  </template>
                  <template v-else>{{ frontendVersionDisplay.text }}</template>
                </span>
              </div>
              <div class="version-item">
                <span class="version-label">认证资源版本：</span>
                <span class="version-value">{{ stats.authVersion || '-' }}</span>
              </div>
              <div class="version-item">
                <span class="version-label">站点资源版本：</span>
                <span class="version-value">{{ stats.indexerVersion || '-' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <el-dialog v-model="dialogVisible" title="编辑资料" width="92%" align-center>
      <el-form :model="edit" label-width="64px">
        <el-form-item label="用户名">
          <el-input v-model="edit.name" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="edit.email" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  mdiCrown,
  mdiPencil,
  mdiPowerStandby,
  mdiEmailOutline,
  mdiMovieOutline,
  mdiTelevisionClassic,
  mdiDelete,
  mdiSwapHorizontal,
} from '@mdi/js'
import {
  loadUser,
  updateUserInfo,
  fetchSystemEnv,
  unwrapSystemEnv,
  extractGithubToken,
  fetchLatestSoftwareVersion,
  fetchLatestFrontendVersion,
  formatVersionWithLatest,
} from '../services/user'
import { fetchSites, fetchSupporting, hasCookieDiff, hasUADiff } from '../services/site-manage'
import {
  logout,
  listAccounts,
  switchAccount,
  removeAccount,
  type MpAccountPublic,
} from '../services/auth'
import { api, unwrapApiData } from '../core/http'
import { appState } from '../core/state'
import type { UserInfo } from '../core/types'
import { getDomainCookies } from '../utils/cookie'
import { ElMessage, confirmAction } from '../utils/ui'
import { getUserInfo } from '../services/auth'
import { maskBaseUrl } from '../utils/url'

const loading = ref(true)
const user = ref<UserInfo | null>(null)
const movieCount = ref(0)
const tvCount = ref(0)
const dialogVisible = ref(false)
const saving = ref(false)
const edit = reactive({ name: '', email: '' })
const accounts = ref<MpAccountPublic[]>([])
const switchingId = ref<string | null>(null)
const removingId = ref<string | null>(null)
/** 登录会话缓存的权限（/user/current 无 permissions 时兜底） */
const sessionPermissions = ref<Record<string, unknown> | null>(null)

type PermCategoryKey = 'discovery' | 'search' | 'subscribe' | 'manage'

/** 用户编辑对话框支持的权限项目。 */
const PERM_CATEGORY: Array<{ key: PermCategoryKey; label: string; desc: string }> = [
  { key: 'discovery', label: '发现', desc: '访问推荐和探索功能' },
  { key: 'search', label: '搜索', desc: '搜索站点资源和添加下载' },
  { key: 'subscribe', label: '订阅', desc: '管理电影和电视剧订阅' },
  { key: 'manage', label: '管理', desc: '访问下载管理和站点管理等功能' },
]

/** 账号列表仅展示脱敏域名，完整地址不直出 UI */
function hostOf(url: string): string {
  return maskBaseUrl(url)
}

function asPermRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

const resolvedPermissions = computed(() => {
  const fromUser = asPermRecord(user.value?.permissions)
  const fromSession = asPermRecord(sessionPermissions.value)
  // 接口字段优先，会话缓存补缺
  return { ...fromSession, ...fromUser }
})

const showPermissionSection = computed(() => !!user.value && user.value.is_superuser !== true)

function isCategoryEnabled(key: PermCategoryKey, perms: Record<string, unknown>): boolean {
  // 默认启用 discovery、search 和 subscribe 权限，manage 权限默认关闭。
  if (typeof perms[key] === 'boolean') return !!perms[key]
  return key !== 'manage'
}

/** 仅展示已启用的权限分类标签（发现 / 搜索 / 订阅 / 管理） */
const enabledPermissionTags = computed(() => {
  const perms = resolvedPermissions.value
  return PERM_CATEGORY.filter((c) => isCategoryEnabled(c.key, perms)).map((c) => ({
    key: c.key,
    label: c.label,
    desc: c.desc,
  }))
})

async function refreshAccounts(): Promise<void> {
  try {
    accounts.value = await listAccounts()
  } catch {
    accounts.value = []
  }
}

async function loadSessionPermissions(): Promise<void> {
  try {
    const info = await getUserInfo()
    sessionPermissions.value = (info?.permissions as Record<string, unknown>) || null
  } catch {
    sessionPermissions.value = null
  }
}

const stats = reactive({
  supportingSites: 0,
  configSites: 0,
  cookieCount: 0,
  pending: 0,
  systemVersion: '',
  /** GitHub 最新软件版本（/system/versions） */
  systemLatestVersion: '',
  /** 当前前端版本（env.FRONTEND_VERSION） */
  frontendVersion: '',
  /** GitHub MoviePilot-Frontend releases 最新 tag */
  frontendLatestVersion: '',
  authVersion: '',
  indexerVersion: '',
})

const displayName = computed(() => user.value?.name || '用户')
const initials = computed(() => displayName.value.charAt(0).toUpperCase() || 'U')

/** 软件版本展示：最新则仅当前；落后则 `当前→最新` */
const systemVersionDisplay = computed(() =>
  formatVersionWithLatest(stats.systemVersion, stats.systemLatestVersion),
)

/** 前端版本展示：同上 */
const frontendVersionDisplay = computed(() =>
  formatVersionWithLatest(stats.frontendVersion, stats.frontendLatestVersion),
)

async function fetchSubscriptions(name: string): Promise<void> {
  try {
    const res = await api.get<Array<{ type?: string }>>(
      `/api/v1/subscribe/user/${encodeURIComponent(name)}`,
    )
    const payload = unwrapApiData<Array<{ type?: string }> | null>(res.data)
    const list = res.ok && Array.isArray(payload) ? payload : []
    movieCount.value = list.filter((it) => it.type === '电影').length
    tvCount.value = list.filter((it) => it.type === '电视剧').length
  } catch {
    movieCount.value = 0
    tvCount.value = 0
  }
}

async function fetchSiteStats(): Promise<void> {
  try {
    const [sites, supporting] = await Promise.all([fetchSites(), fetchSupporting()])
    const real = sites.filter((s) => s.id && s.id > 0)
    stats.supportingSites = Object.keys(supporting).length
    stats.configSites = real.length
    stats.cookieCount = real.filter((s) => !!(s.cookie && s.cookie.trim())).length

    const ua = navigator.userAgent
    let pending = 0
    await Promise.all(
      real.map(async (s) => {
        try {
          const bc = await getDomainCookies(s.url || '')
          if (hasCookieDiff(s.cookie, bc) || hasUADiff(s.ua, ua)) pending++
        } catch {
          /* 单个站点 Cookie 读取失败时不计入待同步数量。 */
        }
      }),
    )
    stats.pending = pending
  } catch {
    stats.supportingSites = 0
    stats.configSites = 0
    stats.cookieCount = 0
    stats.pending = 0
  }
}

/** 仅内存持有，供后台版本检查使用，不落盘 */
let githubTokenMem = ''

/** 主路径：当前版本字段（本地 MP 接口，通常很快） */
async function loadEnvBasics(): Promise<void> {
  try {
    const env = await fetchSystemEnv()
    const data = unwrapSystemEnv(env) as Record<string, string> | null
    if (data) {
      stats.systemVersion = data.VERSION || ''
      stats.frontendVersion = data.FRONTEND_VERSION || ''
      stats.authVersion = data.AUTH_VERSION || ''
      stats.indexerVersion = data.INDEXER_VERSION || ''
    }
    githubTokenMem = extractGithubToken(env)
  } catch {
    githubTokenMem = ''
  }
}

/** 次路径：GitHub 最新版（缓存/超时，失败只显示当前版本） */
async function loadLatestVersions(): Promise<void> {
  try {
    const [latestSoftware, latestFrontend] = await Promise.all([
      fetchLatestSoftwareVersion(),
      fetchLatestFrontendVersion(githubTokenMem),
    ])
    stats.systemLatestVersion = latestSoftware || ''
    stats.frontendLatestVersion = latestFrontend || ''
  } catch {
    /* 最新版本查询失败时保留当前版本展示。 */
  }
}

/** 主信息就绪后的后台补齐：订阅 / 站点统计 / 最新版本 */
async function loadSecondary(): Promise<void> {
  const name = user.value?.name
  await Promise.all([
    name ? fetchSubscriptions(name) : Promise.resolve(),
    fetchSiteStats(),
    loadLatestVersions(),
  ])
}

async function refreshAll(): Promise<void> {
  loading.value = true
  try {
    // 主路径：只等用户/账号/当前版本，尽快结束 skeleton
    await Promise.all([
      loadUser(),
      refreshAccounts(),
      loadSessionPermissions(),
      loadEnvBasics(),
    ])
    user.value = appState.user
  } catch {
    ElMessage.error('数据加载失败')
  } finally {
    loading.value = false
  }
  // 次路径：不阻塞首屏；订阅数/站点统计/GitHub 最新版后台写入
  void loadSecondary()
}

function onAddAccount(): void {
  // 退回登录页添加新账号（不清除账号库）；强制打开「重新登录」表单而非快捷登录
  appState.preferLoginForm = true
  appState.loggedIn = false
  appState.unlocked = false
  appState.user = null
}

async function onSwitchAccount(id: string): Promise<void> {
  if (switchingId.value) return
  switchingId.value = id
  try {
    const res = await switchAccount(id)
    if (!res.success) {
      ElMessage.error(res.message ?? '切换失败')
      return
    }
    ElMessage.success('已切换账号')
    await refreshAll()
  } finally {
    switchingId.value = null
  }
}

async function onRemoveAccount(acc: MpAccountPublic): Promise<void> {
  try {
    await confirmAction(`确定移除账号「${acc.label || acc.username}」？将删除本地保存的密码。`, {
      title: '移除账号',
      kind: 'danger',
      confirmButtonText: '移除',
    })
  } catch {
    return
  }
  removingId.value = acc.id
  try {
    const wasActive = acc.isActive
    await removeAccount(acc.id)
    if (wasActive) {
      appState.loggedIn = false
      appState.unlocked = false
      appState.user = null
      ElMessage.success('已移除当前账号')
      return
    }
    await refreshAccounts()
    ElMessage.success('已移除账号')
  } finally {
    removingId.value = null
  }
}

function openEdit(): void {
  if (!user.value) return
  edit.name = user.value.name
  edit.email = user.value.email ?? ''
  dialogVisible.value = true
}

async function onSave(): Promise<void> {
  if (!edit.name) {
    ElMessage.warning('用户名不能为空')
    return
  }
  saving.value = true
  try {
    const ok = await updateUserInfo({ name: edit.name, email: edit.email })
    if (ok) {
      ElMessage.success('已保存')
      dialogVisible.value = false
      await loadUser()
      user.value = appState.user
    } else {
      ElMessage.error('保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function onLogout(): Promise<void> {
  try {
    await confirmAction('确定退出当前账号吗？本地仍保留该账号密码，可在登录页再次切换。', {
      title: '注销确认',
      kind: 'warning',
      confirmButtonText: '退出',
    })
  } catch {
    return
  }
  await logout()
  appState.loggedIn = false
  appState.unlocked = false
  appState.user = null
  ElMessage.success('已退出当前账号')
}

onMounted(refreshAll)
</script>

<style scoped>
.user-root {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.account-card {
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 42%);
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.045);
  padding: 10px 10px 8px;
  flex-shrink: 0;
}
.account-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 2px;
}
.account-card-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.account-card-title {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  letter-spacing: 0.01em;
}
.account-card-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.08);
  color: #4096ff;
  font-size: 11px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.account-add-btn {
  /* 添加账号按钮使用注销按钮的尺寸和字重，并保留蓝色操作语义。 */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  box-sizing: border-box;
  padding: 4px 10px;
  border: 1px solid rgba(22, 119, 255, 0.28);
  border-radius: 8px;
  background: rgba(22, 119, 255, 0.06);
  color: #4096ff;
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.account-add-btn:hover {
  background: rgba(22, 119, 255, 0.1);
  border-color: rgba(22, 119, 255, 0.4);
  color: #1677ff;
}
.account-add-plus {
  font-size: 12px;
  line-height: 1;
  font-weight: 400;
  display: inline-flex;
  align-items: center;
  height: 1em;
}
.account-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.account-row {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  min-width: 0;
  padding: 8px 8px 8px 9px;
  border-radius: 11px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  box-sizing: border-box;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.account-row.active {
  border-color: rgba(22, 119, 255, 0.4);
  background: rgba(22, 119, 255, 0.07);
  box-shadow: inset 0 0 0 1px rgba(22, 119, 255, 0.08);
}
.account-row:not(.active):hover {
  border-color: rgba(22, 119, 255, 0.35);
  box-shadow: 0 3px 10px rgba(22, 119, 255, 0.08);
}
.account-row.busy {
  opacity: 0.9;
}
.account-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.account-main:disabled {
  cursor: default;
}
.account-avatar {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(145deg, #dbeafe, #e0e7ff);
  color: #3730a3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  flex: 0 0 auto;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
}
.account-avatar.has-img {
  background: #f1f5f9;
}
.account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.account-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.account-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.account-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-role-tags {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.account-role-tags :deep(.el-tag) {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  border-radius: 4px;
}
.account-sub {
  min-width: 0;
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}
.account-status-dot {
  width: 8px;
  height: 8px;
  margin: 0 10px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
  flex: 0 0 auto;
}
.account-switch,
.account-remove {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  padding: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.account-switch svg,
.account-remove svg {
  display: block;
}
.account-switch svg path,
.account-remove svg path {
  fill: currentColor;
}
.account-switch:hover:not(:disabled) {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.1);
}
.account-switch.busy {
  color: #1677ff;
  opacity: 0.7;
}
.account-remove:hover:not(:disabled) {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}
.account-switch:disabled,
.account-remove:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}


/* 用户卡片 */
.user-card {
  border-radius: 12px;
  background: linear-gradient(180deg, #fff7e6 0%, #ffffff 35%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
  padding: 10px;
  margin-bottom: 0;
  box-sizing: border-box;
  flex-shrink: 0;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
}

.avatar-box {
  position: relative;
  display: inline-block;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.avatar-box :deep(.el-avatar) {
  width: 56px !important;
  height: 56px !important;
}

.avatar-squared :deep(.el-avatar__img),
.avatar-squared :deep(.el-avatar__text) {
  border-radius: 12px;
}

.avatar-squared {
  border: 3px solid #f7b501;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(247, 181, 1, 0.25) inset;
}

.crown {
  position: absolute;
  top: -6px;
  left: -6px;
  transform: rotate(-45deg);
  animation: wiggle 2.4s ease-in-out infinite;
  z-index: 5;
  pointer-events: none;
}

.crown svg {
  fill: #f7b501;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.28));
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.spacer {
  flex: 1 1 auto;
}

.name {
  font-size: 16px;
  font-weight: 700;
  color: #f59e0b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badges :deep(.el-tag) {
  margin-right: 6px;
}

.edit {
  opacity: 0.6;
  flex-shrink: 0;
}

.edit svg {
  fill: #a8a8a8;
}

.edit:hover svg {
  fill: #f59e0b;
}

.logout-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  box-sizing: border-box;
  padding: 4px 10px;
  border: 1px solid #ffa39e;
  border-radius: 8px;
  background: #fff1f0;
  color: #ff4d4f;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
  flex-shrink: 0;
}

.logout-btn:hover {
  background: #ffe2e1;
}

.logout-btn .power path {
  fill: #ff4d4f;
}

.divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 6px 2px;
}

/* 邮箱和普通用户权限标签位于同一行右侧 */
.email-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
  min-width: 0;
}

.email {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6b7280;
  font-size: 12px;
  min-width: 0;
  flex: 1 1 auto;
}

.email span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.email .mail {
  opacity: 0.9;
  flex-shrink: 0;
}

.email .mail path {
  fill: #8ea6ff;
}

.perm-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  max-width: 58%;
}

.perm-tag {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.perm-tag--discovery {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  border-color: rgba(124, 58, 237, 0.18);
}

.perm-tag--search {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  border-color: rgba(37, 99, 235, 0.18);
}

.perm-tag--subscribe {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
  border-color: rgba(5, 150, 105, 0.18);
}

.perm-tag--manage {
  color: #d97706;
  background: rgba(217, 119, 6, 0.1);
  border-color: rgba(217, 119, 6, 0.18);
}

/* 订阅统计：电影 / 剧集 */
.sub-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-width: 0;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.05);
  min-width: 0;
  box-sizing: border-box;
}

.stat-row .bubble {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-row .stat-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat-row .num {
  font-size: 18px;
  font-weight: 700;
  line-height: 18px;
  color: #1f2937;
}

.stat-row .label {
  font-size: 12px;
  color: #8c8c8c;
}

/* 电影订阅配色 */
.stat-row.movie .bubble {
  background: #fff2cf;
  color: #d48806;
}

.stat-row.movie svg,
.stat-row.movie svg path {
  fill: #faad14;
}

/* 剧集订阅配色 */
.stat-row.tv .bubble {
  background: #d9f3ff;
  color: #1394cf;
}

.stat-row.tv svg,
.stat-row.tv svg path {
  fill: #4db8ff;
}

@keyframes wiggle {
  0%,
  100% {
    transform: rotate(-42deg) translateY(0);
  }
  50% {
    transform: rotate(-48deg) translateY(-1px);
  }
}

/* 综合信息卡片：拉伸填满剩余高度，消除底部空白 */
.comprehensive-info {
  margin-top: 0;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.comprehensive-card {
  border-radius: 12px;
  background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 35%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
  padding: 10px;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.stats-section {
  margin-bottom: 0;
  flex-shrink: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.stat-item {
  text-align: center;
  padding: 8px 4px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.stat-num {
  font-size: 15px;
  font-weight: 700;
  line-height: 18px;
  margin-bottom: 2px;
}

.stat-label {
  font-size: 10px;
  color: #6c757d;
}

.stat-config .stat-num {
  color: #1976d2;
}
.stat-config {
  background: linear-gradient(135deg, #e3f2fd 0%, #f8f9fa 100%);
}

.stat-supporting .stat-num {
  color: #00838f;
}
.stat-supporting {
  background: linear-gradient(135deg, #e0f7fa 0%, #e8f5e9 100%);
}

.stat-cookie .stat-num {
  color: #f57c00;
}
.stat-cookie {
  background: linear-gradient(135deg, #fff3e0 0%, #f8f9fa 100%);
}

.stat-pending .stat-num {
  color: #7b1fa2;
}
.stat-pending {
  background: linear-gradient(135deg, #f3e5f5 0%, #f8f9fa 100%);
}

.version-section {
  margin-top: 0;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.version-title {
  font-size: 12px;
  font-weight: 600;
  color: #495057;
  margin-bottom: 8px;
  text-align: center;
  flex-shrink: 0;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.version-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
  font-size: 11px;
}

.version-label {
  color: #6c757d;
  font-weight: 500;
}

.version-value {
  color: #495057;
  font-weight: 600;
  font-family: 'Courier New', monospace;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/* 非最新：浅灰当前 + 琥珀色箭头 + 琥珀色最新 */
.version-value.is-outdated {
  color: #f59e0b;
  font-weight: 600;
}

.version-current {
  /* 使用普通版本号的文字颜色 */
  color: #495057;
  font-weight: 600;
}

.version-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #f59e0b;
  flex-shrink: 0;
  opacity: 0.95;
}

.version-arrow svg {
  display: block;
}

.version-latest {
  color: #f59e0b;
  font-weight: 700;
}

/* 加载骨架覆盖用户卡、账号卡和综合信息卡 */
.user-loading-card,
.user-loading-account-card,
.user-loading-info-card {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
  padding: 10px;
  pointer-events: none;
  flex-shrink: 0;
}

.user-loading-card {
  background: linear-gradient(180deg, #fff7e6 0%, #ffffff 35%);
}

.user-loading-account-card {
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 42%);
  padding: 10px 10px 8px;
}

.user-loading-info-card {
  background: linear-gradient(180deg, #f8f9fa 0%, #ffffff 35%);
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.user-loading-profile {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.user-loading-avatar {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
}

.user-loading-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-loading-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.user-loading-spacer {
  flex: 1 1 auto;
}

.user-loading-line {
  height: 10px;
  border-radius: 999px;
}

.user-loading-line.name {
  width: 96px;
  max-width: 42%;
  height: 16px;
  flex: 0 1 auto;
}

.user-loading-edit {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}

.user-loading-badges {
  display: flex;
  gap: 6px;
}

.user-loading-badge {
  width: 46px;
  height: 22px;
  border-radius: 6px;
}

.user-loading-button {
  width: 58px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
}

.user-loading-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 8px 2px;
  flex-shrink: 0;
}

.user-loading-email-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 6px;
  min-width: 0;
}

.user-loading-email {
  width: 42%;
  max-width: 160px;
  height: 12px;
  border-radius: 999px;
  flex: 1 1 auto;
}

.user-loading-perm-tags {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.user-loading-perm {
  width: 36px;
  height: 18px;
  border-radius: 999px;
}

.user-loading-sub-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-width: 0;
}

.user-loading-sub-stat {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.05);
  min-width: 0;
  box-sizing: border-box;
}

.user-loading-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
}

.user-loading-sub-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-loading-line.count {
  width: 36px;
  height: 16px;
}

.user-loading-line.label {
  width: 52px;
  height: 9px;
}

/* 账号管理骨架 */
.user-loading-account-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 2px;
}

.user-loading-account-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.user-loading-line.account-title {
  width: 56px;
  height: 13px;
}

.user-loading-account-count {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  flex-shrink: 0;
}

.user-loading-account-add {
  width: 78px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
}

.user-loading-account-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-loading-account-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 8px 8px 8px 9px;
  border-radius: 11px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  box-sizing: border-box;
}

.user-loading-account-avatar {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  flex: 0 0 auto;
}

.user-loading-account-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-loading-account-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.user-loading-line.account-name {
  width: 72px;
  max-width: 50%;
  height: 12px;
}

.user-loading-account-tag {
  width: 42px;
  height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
}

.user-loading-line.account-sub {
  width: 68%;
  max-width: 180px;
  height: 10px;
}

.user-loading-account-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}

.user-loading-account-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.user-loading-account-action {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

.user-loading-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
}

.user-loading-stat {
  min-height: 42px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 4px;
}

.user-loading-line.stat-num {
  width: 34px;
  height: 16px;
  margin-bottom: 5px;
}

.user-loading-line.stat-label {
  width: 58px;
  height: 9px;
}

.user-loading-version-title {
  width: 126px;
  height: 12px;
  border-radius: 999px;
  margin: 8px auto;
  flex-shrink: 0;
}

.user-loading-version-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 0;
}

.user-loading-version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 3px 0;
}

.user-loading-line.version-label {
  width: 92px;
  max-width: 50%;
  height: 10px;
}

.user-loading-line.version-value {
  width: 86px;
  max-width: 45%;
  height: 10px;
}

.user-loading-shimmer {
  background: linear-gradient(90deg, #edf2f7 25%, #f8fafc 37%, #edf2f7 63%);
  background-size: 400% 100%;
  animation: user-loading-shimmer 1.25s ease-in-out infinite;
}

@keyframes user-loading-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}

/* 暗色主题（ User + UserCard，!important 覆盖浅色硬编码） */
:global(html[data-theme='dark']) .account-card {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, #1e293b 42%) !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25) !important;
}
:global(html[data-theme='dark']) .account-card-title {
  color: #94a3b8 !important;
  font-weight: 500 !important;
}
:global(html[data-theme='dark']) .account-card-count {
  background: rgba(59, 130, 246, 0.12) !important;
  color: #93c5fd !important;
  font-weight: 500 !important;
}
:global(html[data-theme='dark']) .account-add-btn {
  background: rgba(59, 130, 246, 0.1) !important;
  border-color: rgba(59, 130, 246, 0.28) !important;
  color: #93c5fd !important;
  font-weight: 400 !important;
}
:global(html[data-theme='dark']) .account-add-btn:hover {
  background: rgba(59, 130, 246, 0.16) !important;
  border-color: rgba(59, 130, 246, 0.4) !important;
}
:global(html[data-theme='dark']) .account-row {
  background: rgba(15, 23, 42, 0.55) !important;
  border-color: #334155 !important;
}
:global(html[data-theme='dark']) .account-row.active {
  border-color: rgba(59, 130, 246, 0.5) !important;
  background: rgba(59, 130, 246, 0.14) !important;
  box-shadow: none !important;
}
:global(html[data-theme='dark']) .account-row:not(.active):hover {
  border-color: rgba(59, 130, 246, 0.4) !important;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.22) !important;
}
:global(html[data-theme='dark']) .account-name {
  color: #f1f5f9 !important;
}
:global(html[data-theme='dark']) .account-role-tags :deep(.el-tag--danger) {
  color: #f87171 !important;
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.25) !important;
}
:global(html[data-theme='dark']) .account-role-tags :deep(.el-tag--info) {
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.12) !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
}
:global(html[data-theme='dark']) .account-sub {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .account-avatar {
  background: linear-gradient(145deg, rgba(59, 130, 246, 0.28), rgba(99, 102, 241, 0.22)) !important;
  color: #93c5fd !important;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18) !important;
}
:global(html[data-theme='dark']) .account-avatar.has-img {
  background: #0f172a !important;
}
:global(html[data-theme='dark']) .account-status-dot {
  background: #4ade80 !important;
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.18) !important;
}
:global(html[data-theme='dark']) .account-switch,
:global(html[data-theme='dark']) .account-remove {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .account-switch:hover:not(:disabled) {
  color: #93c5fd !important;
  background: rgba(59, 130, 246, 0.14) !important;
}
:global(html[data-theme='dark']) .account-remove:hover:not(:disabled) {
  color: #f87171 !important;
  background: rgba(239, 68, 68, 0.12) !important;
}


:global(html[data-theme='dark']) .email {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .email .mail path {
  fill: #60a5fa !important;
}
:global(html[data-theme='dark']) .perm-tag--discovery {
  color: #c4b5fd !important;
  background: rgba(124, 58, 237, 0.18) !important;
  border-color: rgba(167, 139, 250, 0.28) !important;
}
:global(html[data-theme='dark']) .perm-tag--search {
  color: #93c5fd !important;
  background: rgba(59, 130, 246, 0.18) !important;
  border-color: rgba(96, 165, 250, 0.28) !important;
}
:global(html[data-theme='dark']) .perm-tag--subscribe {
  color: #6ee7b7 !important;
  background: rgba(16, 185, 129, 0.16) !important;
  border-color: rgba(52, 211, 153, 0.28) !important;
}
:global(html[data-theme='dark']) .perm-tag--manage {
  color: #fbbf24 !important;
  background: rgba(245, 158, 11, 0.16) !important;
  border-color: rgba(251, 191, 36, 0.28) !important;
}

:global(html[data-theme='dark']) .user-card {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, #1e293b 35%) !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3) !important;
}

/* 覆盖全局暗色 svg path currentColor，保持皇冠金色 */
:global(html[data-theme='dark']) .crown,
:global(html[data-theme='dark']) .crown svg,
:global(html[data-theme='dark']) .crown svg path {
  color: #fbbf24 !important;
  fill: #fbbf24 !important;
}

:global(html[data-theme='dark']) .avatar-squared {
  border-color: #fbbf24 !important;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.28) inset !important;
}

:global(html[data-theme='dark']) .name {
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .edit svg,
:global(html[data-theme='dark']) .edit svg path {
  fill: #94a3b8 !important;
}

:global(html[data-theme='dark']) .edit:hover svg,
:global(html[data-theme='dark']) .edit:hover svg path {
  fill: #fbbf24 !important;
}

:global(html[data-theme='dark']) .logout-btn,
:global(html[data-theme='dark']) .logout-btn span {
  color: #f87171 !important;
}

:global(html[data-theme='dark']) .logout-btn {
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
}

:global(html[data-theme='dark']) .logout-btn:hover {
  background: rgba(239, 68, 68, 0.25) !important;
}

:global(html[data-theme='dark']) .logout-btn .power path {
  fill: #f87171 !important;
}

:global(html[data-theme='dark']) .divider {
  background: #334155 !important;
}

:global(html[data-theme='dark']) .stat-row {
  background: #0f172a !important;
  border-color: #334155 !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
}

:global(html[data-theme='dark']) .stat-row .num {
  color: #f1f5f9 !important;
}

:global(html[data-theme='dark']) .stat-row .label {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .stat-row.movie .bubble {
  background: rgba(250, 173, 20, 0.15) !important;
}

:global(html[data-theme='dark']) .stat-row.movie svg,
:global(html[data-theme='dark']) .stat-row.movie svg path {
  fill: #fbbf24 !important;
}

:global(html[data-theme='dark']) .stat-row.tv .bubble {
  background: rgba(77, 184, 255, 0.15) !important;
}

:global(html[data-theme='dark']) .stat-row.tv svg,
:global(html[data-theme='dark']) .stat-row.tv svg path {
  fill: #60a5fa !important;
}

:global(html[data-theme='dark']) .badges :deep(.el-tag--danger) {
  color: #f87171 !important;
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.25) !important;
}

:global(html[data-theme='dark']) .badges :deep(.el-tag--success) {
  color: #4ade80 !important;
  background: rgba(34, 197, 94, 0.15) !important;
  border-color: rgba(34, 197, 94, 0.25) !important;
}

:global(html[data-theme='dark']) .badges :deep(.el-tag--info) {
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.12) !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
}

:global(html[data-theme='dark']) .comprehensive-card {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3) !important;
}

:global(html[data-theme='dark']) .stat-item {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: none !important;
}

:global(html[data-theme='dark']) .stat-config {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(30, 41, 59, 0.5) 100%) !important;
  border-color: rgba(59, 130, 246, 0.25) !important;
}
:global(html[data-theme='dark']) .stat-config .stat-num {
  color: #60a5fa !important;
}

:global(html[data-theme='dark']) .stat-supporting {
  background: linear-gradient(135deg, rgba(0, 131, 143, 0.15) 0%, rgba(30, 41, 59, 0.5) 100%) !important;
  border-color: rgba(0, 131, 143, 0.25) !important;
}
:global(html[data-theme='dark']) .stat-supporting .stat-num {
  color: #22d3ee !important;
}

:global(html[data-theme='dark']) .stat-cookie {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(30, 41, 59, 0.5) 100%) !important;
  border-color: rgba(245, 158, 11, 0.25) !important;
}
:global(html[data-theme='dark']) .stat-cookie .stat-num {
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .stat-pending {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(30, 41, 59, 0.5) 100%) !important;
  border-color: rgba(168, 85, 247, 0.25) !important;
}
:global(html[data-theme='dark']) .stat-pending .stat-num {
  color: #c084fc !important;
}

:global(html[data-theme='dark']) .stat-label {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .version-title,
:global(html[data-theme='dark']) .version-value {
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .version-value.is-outdated {
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .version-current {
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .version-arrow {
  color: #fbbf24 !important;
}

:global(html[data-theme='dark']) .version-latest {
  color: #fbbf24 !important;
  font-weight: 700 !important;
}

:global(html[data-theme='dark']) .version-label {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .user-loading-card {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, #1e293b 35%) !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3) !important;
}

:global(html[data-theme='dark']) .user-loading-account-card {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, #1e293b 42%) !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25) !important;
}

:global(html[data-theme='dark']) .user-loading-info-card {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3) !important;
}

:global(html[data-theme='dark']) .user-loading-shimmer {
  background: linear-gradient(90deg, #334155 25%, #475569 37%, #334155 63%) !important;
  background-size: 400% 100% !important;
}

:global(html[data-theme='dark']) .user-loading-sub-stat,
:global(html[data-theme='dark']) .user-loading-stat,
:global(html[data-theme='dark']) .user-loading-account-row {
  background: #0f172a !important;
  border-color: #334155 !important;
}

:global(html[data-theme='dark']) .user-loading-divider {
  background: #334155 !important;
}
</style>
