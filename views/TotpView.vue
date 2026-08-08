<template>
  <div class="totp-manager">
    <div class="toolbar">
      <div class="toolbar-row">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索站点..."
          size="small"
          clearable
          class="search-input"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" width="14" height="14" class="icon-prefix">
              <path :d="mdiMagnify" />
            </svg>
          </template>
        </el-input>

        <el-dropdown trigger="click" @command="handleSortCommand">
          <el-button class="compact sort-button" size="small" title="排序">
            <svg viewBox="0 0 24 24" width="16" height="16" class="icon-btn-only">
              <path :d="mdiSortVariant" />
            </svg>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="name" :disabled="sortBy === 'name'">按名称排序</el-dropdown-item>
              <el-dropdown-item command="createdAt" :disabled="sortBy === 'createdAt'">按创建时间排序</el-dropdown-item>
              <el-dropdown-item command="updatedAt" :disabled="sortBy === 'updatedAt'">按更新时间排序</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button
          class="compact add-button"
          size="small"
          type="primary"
          :title="currentTab === 'custom' ? '添加自定义站点' : '添加PT站点'"
          @click="openAddDialog"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" class="icon-btn-only">
            <path :d="mdiPlus" />
          </svg>
        </el-button>

        <el-dropdown trigger="click" @command="handleMoreCommand">
          <el-button class="compact more-button" size="small" title="更多操作">
            <svg viewBox="0 0 24 24" width="16" height="16" class="icon-btn-only">
              <path :d="mdiDotsVertical" />
            </svg>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="refresh">
                <div class="dropdown-item-content">
                  <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiRefresh" /></svg>
                  刷新验证码
                </div>
              </el-dropdown-item>
              <el-dropdown-item command="json-export" divided>
                <div class="dropdown-item-content">
                  <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiExportVariant" /></svg>
                  导出本地 JSON
                </div>
              </el-dropdown-item>
              <el-dropdown-item command="json-import">
                <div class="dropdown-item-content">
                  <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiImport" /></svg>
                  导入本地 JSON
                </div>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="totp-tabs">
      <div
        class="totp-tab-item"
        :class="{ active: currentTab === 'pt' }"
        @click="currentTab = 'pt'"
      >
        PT站点
      </div>
      <div
        class="totp-tab-item"
        :class="{ active: currentTab === 'custom' }"
        @click="currentTab = 'custom'"
      >
        自定义
      </div>
    </div>

    <div class="totp-grid">
      <div v-if="loading && sites.length === 0" class="totp-loading-cards">
        <div v-for="item in 3" :key="item" class="totp-loading-card">
          <div class="totp-loading-main">
            <div class="totp-loading-avatar totp-loading-shimmer"></div>
            <div class="totp-loading-info">
              <div class="totp-loading-line name totp-loading-shimmer"></div>
              <div class="totp-loading-line domain totp-loading-shimmer"></div>
            </div>
            <div class="totp-loading-actions">
              <div class="totp-loading-action totp-loading-shimmer"></div>
              <div class="totp-loading-action totp-loading-shimmer"></div>
              <div class="totp-loading-action totp-loading-shimmer"></div>
            </div>
          </div>
          <div class="totp-loading-code-row">
            <div class="totp-loading-code totp-loading-shimmer"></div>
            <div class="totp-loading-timer totp-loading-shimmer"></div>
          </div>
        </div>
      </div>

      <div v-else-if="filteredSites.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" class="empty-icon">
          <path :d="mdiShieldKeyOutline" />
        </svg>
        <p class="empty-text">
          {{ searchKeyword ? '无匹配站点' : currentTab === 'pt' ? '暂无 PT 站点' : '暂无自定义站点' }}
        </p>
        <el-button type="primary" size="small" @click="openAddDialog">添加站点</el-button>
      </div>

      <div v-else class="totp-cards">
        <div v-for="site in filteredSites" :key="site.id" class="totp-card">
          <div class="card-main">
            <div
              class="site-avatar"
              :class="{ 'has-icon': !!totpIconOf(site) }"
              :style="totpIconOf(site) ? undefined : { background: avatarBg(site) }"
            >
              <img
                v-if="totpIconOf(site)"
                :src="totpIconOf(site)!"
                class="site-icon-img"
                alt=""
                :data-domain="displayDomain(site)"
                :data-site-id="site.id"
                @error="onIconError"
              />
              <span v-else>{{ avatarChar(site) }}</span>
            </div>
            <div class="site-details">
              <div class="site-name" :title="site.name">{{ site.name }}</div>
              <div
                v-if="displayDomain(site)"
                class="site-domain"
                :class="{ 'link-style': !!siteUrl(site) }"
                :title="displayDomain(site)"
                @click="openSite(site)"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" class="domain-icon">
                  <path :d="mdiOpenInNew" />
                </svg>
                <span class="domain-text">{{ displayDomain(site) }}</span>
              </div>
            </div>
            <div class="card-actions">
              <el-button class="action-btn" size="small" title="复制验证码" @click="copyCode(site)">
                <svg viewBox="0 0 24 24" width="14" height="14"><path :d="mdiContentCopy" /></svg>
              </el-button>
              <el-button
                class="action-btn"
                size="small"
                title="打开站点"
                :disabled="!siteUrl(site)"
                @click="openSite(site)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path :d="mdiOpenInNew" /></svg>
              </el-button>
              <el-dropdown
                trigger="click"
                popper-class="totp-more-dropdown"
                @command="(c: string) => onCardMenu(c, site)"
              >
                <el-button class="action-btn" size="small" title="更多">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path :d="mdiDotsVertical" /></svg>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <div class="dropdown-item-content">
                        <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiPencil" /></svg>
                        编辑
                      </div>
                    </el-dropdown-item>
                    <el-dropdown-item command="toggle-category">
                      <div class="dropdown-item-content">
                        <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiSwapHorizontal" /></svg>
                        {{ getCategory(site) === 'pt' ? '移到自定义' : '移到PT站点' }}
                      </div>
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided class="delete-menu-item">
                      <div class="dropdown-item-content text-danger">
                        <svg viewBox="0 0 24 24" width="14" height="14" class="mr-1"><path :d="mdiDelete" /></svg>
                        删除
                      </div>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>

          <div class="card-code-row">
            <div class="code-wrap">
              <span class="code-label">验证码</span>
              <span
                class="code-value code-value--round"
                :class="{ loading: !codes[site.id], error: codes[site.id] === 'ERROR' }"
                :title="codes[site.id] && codes[site.id] !== 'ERROR' ? codes[site.id] : undefined"
                @click="copyCode(site)"
              >
                {{ formatCode(codes[site.id]) }}
              </span>
            </div>
            <div class="circular-timer" :title="`剩余 ${remainingSec}s`">
              <svg class="timer-svg" viewBox="0 0 36 36">
                <circle class="timer-bg" cx="18" cy="18" r="15.5" />
                <circle
                  class="timer-progress"
                  cx="18"
                  cy="18"
                  r="15.5"
                  :stroke-dasharray="timerDash"
                  stroke-dashoffset="0"
                />
              </svg>
              <span class="timer-text">{{ remainingSec }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑站点' : '添加站点'"
      width="92%"
      class="mp-sub-dialog"
      append-to-body
      :align-center="false"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <div class="mp-sub-form">
        <el-form :model="form" label-position="top">
          <el-form-item label="名称">
            <el-input v-model="form.name" size="small" placeholder="可选，不填则使用域名" class="mp-sub-control" />
          </el-form-item>
          <el-form-item label="域名" required>
            <el-input
              v-model="form.domain"
              size="small"
              placeholder="必填，需含 http:// 或 https:// 前缀"
              class="mp-sub-control"
            />
          </el-form-item>
          <el-form-item label="分组">
            <el-radio-group v-model="form.category" class="mp-sub-radio">
              <el-radio value="pt">PT站点</el-radio>
              <el-radio value="custom">自定义</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="密钥" required>
            <el-input
              v-model="form.secret"
              size="small"
              show-password
              placeholder="请输入或扫描二维码获取密钥"
              class="mp-sub-control secret-input"
              @input="onSecretInput"
            >
              <template #append>
                <el-button
                  class="secret-get-btn"
                  :loading="scanningPage"
                  :title="scanningPage ? '正在识别…' : '识别当前页面二维码'"
                  @click="scanFromActiveTab"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" class="secret-append-icon" aria-hidden="true">
                    <path :d="mdiQrcodeScan" />
                  </svg>
                  <span class="secret-get-text">获取</span>
                </el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="二维码">
            <div class="qr-upload-row">
              <el-button type="primary" plain size="small" :loading="scanningUpload" @click="uploadQrImage">
                上传二维码
              </el-button>
              <span class="qr-upload-hint">支持识别当前页面二维码，或上传本地二维码图片</span>
            </div>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <div class="mp-sub-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="!canSave" @click="onSave">
            保存
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
// 两步验证页面负责验证码列表、分组、导入和编辑交互。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  mdiMagnify,
  mdiSortVariant,
  mdiPlus,
  mdiDotsVertical,
  mdiRefresh,
  mdiExportVariant,
  mdiImport,
  mdiQrcodeScan,
  mdiShieldKeyOutline,
  mdiContentCopy,
  mdiOpenInNew,
  mdiPencil,
  mdiDelete,
  mdiSwapHorizontal,
} from '@mdi/js'
import {
  loadSites,
  saveSites,
  codeFor,
  remaining,
  importSitesPayload,
} from '../services/totp'
import {
  parseQrPayload,
  parseQrFromImageSrc,
  extractQrFromActiveTab,
  fetchImageAsDataUrl,
  type QrParseResult,
} from '../services/qr-scan'
import type { TotpSite } from '../core/types'
import { ElMessage, confirmDelete, promptPassword } from '../utils/ui'
import { downloadText } from '../utils/file'
import {
  consumePickedPageFiles,
  requestFilesFromActivePage,
  type PickedPageFile,
} from '../core/page-file-picker'
import { resolveSiteIconsBatch } from '../services/site-icon'
import { faviconFallbackChain } from '../services/favicon-discover'
import { stablePaletteValue } from '../utils/format'
import { encryptLocalJsonWithSavedKey } from '../services/local-json-envelope'
import {
  importCompatibleLocalJson,
  inspectLocalJsonImport,
} from '../services/local-json-import-compat'


 type TabKey = 'pt' | 'custom'
type SortKey = 'name' | 'createdAt' | 'updatedAt'

const sites = ref<TotpSite[]>([])
const totpIconMap = ref<Record<string, string>>({})
const codes = ref<Record<string, string>>({})
const loading = ref(true)
const searchKeyword = ref('')
const currentTab = ref<TabKey>('pt')
const sortBy = ref<SortKey>('name')
const scanningPage = ref(false)
const scanningUpload = ref(false)
const remainingSec = ref(remaining())
let timer: number | undefined

const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

interface FormState {
  name: string
  /** 域名或完整网址（保存时自动拆成 domain + url） */
  domain: string
  secret: string
  category: TabKey
}
function emptyForm(): FormState {
  return { name: '', domain: '', secret: '', category: 'pt' }
}

/** 是否带有 http(s) 前缀 */
function hasHttpPrefix(raw: string): boolean {
  return /^https?:\/\//i.test((raw || '').trim())
}

/**
 * 将域名/网址规范为带 http(s) 前缀的展示值。
 * 已有前缀则保留；裸域名默认补 https://
 */
function ensureHttpPrefix(raw: string, preferOrigin?: string): string {
  const input = (raw || '').trim()
  if (!input) {
    if (preferOrigin && hasHttpPrefix(preferOrigin)) return preferOrigin.replace(/\/$/, '')
    return ''
  }
  if (hasHttpPrefix(input)) return input
  // issuer 可能是「站点名」而非域名，仍按用户要求补前缀
  return `https://${input.replace(/^\/+/, '')}`
}

/** 从「域名/网址」输入解析 domain 与 url（要求输入含协议前缀） */
function parseHostInput(raw: string): { domain?: string; url?: string; ok: boolean } {
  const input = raw.trim()
  if (!input) return { ok: false }
  if (!hasHttpPrefix(input)) return { ok: false }
  try {
    const u = new URL(input)
    const domain = u.hostname.replace(/^\./, '') || undefined
    if (!domain) return { ok: false }
    return { domain, url: input, ok: true }
  } catch {
    return { ok: false }
  }
}
const form = ref<FormState>(emptyForm())

const CIRCUM = 2 * Math.PI * 15.5
const timerDash = computed(() => {
  const p = remainingSec.value / 30
  return `${(CIRCUM * p).toFixed(2)} ${CIRCUM.toFixed(2)}`
})

const canSave = computed(() => {
  const secretOk = /^[A-Z2-7]+=*$/i.test(form.value.secret.replace(/\s/g, ''))
  const domainOk = parseHostInput(form.value.domain).ok
  return secretOk && domainOk
})

function getCategory(site: TotpSite): TabKey {
  if (site.category === 'pt' || site.category === 'custom') return site.category
  if (site.group === 'pt' || site.group === 'custom') return site.group
  // 兼容：有 url/domain 视为 pt
  return site.url || site.domain ? 'pt' : 'custom'
}

const filteredSites = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  let list = sites.value.filter((s) => getCategory(s) === currentTab.value)
  if (kw) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        (s.domain || '').toLowerCase().includes(kw) ||
        (s.url || '').toLowerCase().includes(kw),
    )
  }
  const sorted = [...list]
  if (sortBy.value === 'createdAt') {
    sorted.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  } else if (sortBy.value === 'updatedAt') {
    sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }
  return sorted
})

/** 列表展示域名：只显示主机名，不带 http(s):// 前缀 */
function displayDomain(site: TotpSite): string {
  const raw = (site.domain || site.url || '').trim()
  if (!raw) return ''
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProto).hostname.replace(/^\./, '') || raw
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0]
  }
}

function siteUrl(site: TotpSite): string {
  if (site.url && /^https?:\/\//i.test(site.url)) return site.url
  const raw = (site.url || site.domain || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function avatarChar(site: TotpSite): string {
  return (site.name || '?').charAt(0).toUpperCase()
}

const TOTP_AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
] as const

function avatarBg(site: TotpSite): string {
  return stablePaletteValue(site.name || site.domain || '', TOTP_AVATAR_GRADIENTS)
}

function formatCode(code?: string): string {
  if (!code) return '------'
  if (code === 'ERROR') return 'ERROR'
  // 3-3 分组，更易读
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  return code
}

/** 站点自带 icon 加载失败后的屏蔽（避免死循环重试坏图） */
const totpBrokenSiteIcons = ref<Set<string>>(new Set())

function onIconError(e: Event) {
  const img = e.target as HTMLImageElement
  const domain = img.dataset.domain || ''
  const siteId = img.dataset.siteId || ''
  const src = img.currentSrc || img.src || ''

  // 站点自带 icon 失败：记入屏蔽，再走 map 中的 favicon / 字母
  if (siteId) {
    const site = sites.value.find((s) => s.id === siteId)
    if (site?.icon && (src === site.icon || !domain)) {
      const next = new Set(totpBrokenSiteIcons.value)
      next.add(siteId)
      totpBrokenSiteIcons.value = next
      return
    }
  }

  // favicon / 图标包地址失败：先试其它静态路径 → 公共服，再清 map 降级字母
  if (domain) {
    const tried = Number(img.dataset.favTry || '0')
    const chain = faviconFallbackChain(domain, src)
    const nextUrl = chain[tried]
    if (nextUrl && nextUrl !== src) {
      img.dataset.favTry = String(tried + 1)
      const next = { ...totpIconMap.value }
      next[domain] = nextUrl
      for (const [k, v] of Object.entries(next)) {
        if (v === src) next[k] = nextUrl
      }
      totpIconMap.value = next
      return
    }
  }
  if (domain || src) {
    const next = { ...totpIconMap.value }
    if (domain && next[domain]) delete next[domain]
    for (const [k, v] of Object.entries(next)) {
      if (v === src) delete next[k]
    }
    totpIconMap.value = next
  }
}

function totpIconOf(site: TotpSite): string | null {
  // 站点自带 icon（未失败过）
  if (
    site.icon &&
    (site.icon.startsWith('data:') || site.icon.startsWith('http')) &&
    !totpBrokenSiteIcons.value.has(site.id)
  ) {
    return site.icon
  }
  const host = displayDomain(site)
  if (host && totpIconMap.value[host]) return totpIconMap.value[host]
  return null
}

async function loadTotpIcons(): Promise<void> {
  totpBrokenSiteIcons.value = new Set()
  const inputs = sites.value
    .map((s) => ({
      domain: displayDomain(s),
      name: s.name,
      url: s.url || s.domain,
      icon: s.icon,
    }))
    .filter((x) => x.domain && x.domain.includes('.'))
  if (!inputs.length) {
    totpIconMap.value = {}
    return
  }
  // 先返回本地图标，网络发现结果通过回调补充。
  await resolveSiteIconsBatch(inputs, {
    allowApi: false,
    allowFavicon: true,
    deferNetworkDiscover: true,
    discoverConcurrency: 3,
    onUpdate: (map) => {
      totpIconMap.value = map
    },
  })
}

function onSecretInput() {
  form.value.secret = form.value.secret.toUpperCase().replace(/\s/g, '')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    sites.value = await loadSites()
    await refreshCodes()
    // 列表与验证码先上屏；图标后台渐进填充
    loading.value = false
    void loadTotpIcons()
  } catch {
    loading.value = false
  }
}

async function refreshCodes(): Promise<void> {
  const next: Record<string, string> = {}
  for (const s of sites.value) {
    try {
      next[s.id] = await codeFor(s.secret)
    } catch {
      next[s.id] = 'ERROR'
    }
  }
  codes.value = next
}

function startTimer(): void {
  stopTimer()
  timer = window.setInterval(() => {
    remainingSec.value = remaining()
    if (remainingSec.value === 30) void refreshCodes()
  }, 1000)
}
function stopTimer(): void {
  if (timer) window.clearInterval(timer)
}

function handleSortCommand(cmd: string) {
  sortBy.value = cmd as SortKey
}

function handleMoreCommand(cmd: string) {
  if (cmd === 'refresh') {
    void refreshCodes().then(() => ElMessage.success('已刷新验证码'))
  } else if (cmd === 'json-export') {
    void onExport()
  } else if (cmd === 'json-import') {
    void onImport()
  }
}

async function onExport(): Promise<void> {
  try {
    const exportedAt = new Date().toISOString()
    const text = await encryptLocalJsonWithSavedKey('totp', {
      version: 1,
      exportedAt,
      sites: await loadSites(),
    })
    downloadText(`totp-sites-${exportedAt.slice(0, 10)}.json`, text)
    ElMessage.success('已导出加密本地 JSON')
  } catch (e) {
    ElMessage.error(`导出失败：${String(e)}`)
  }
}

async function onImport(): Promise<void> {
  const files = await requestFilesFromActivePage({
    action: 'totp:json',
    view: 'totp',
    accept: 'application/json,.json',
    title: '选择两步验证备份文件',
  })
  if (files[0]) await importTotpFile(files[0])
}

async function importTotpFile(item: PickedPageFile): Promise<void> {
  try {
    const text = new TextDecoder().decode(item.bytes)
    const inspection = inspectLocalJsonImport(text)
    let legacyPassword: string | undefined
    if (inspection.needsLegacyPassword) {
      try {
        legacyPassword = await promptPassword(
          '此文件由旧项目加密导出，请输入正确的旧版备份密钥。',
          '导入旧版两步验证',
          'totp',
        )
      } catch {
        return
      }
    }
    const result = await importCompatibleLocalJson(text, 'totp', legacyPassword)
    if (result.type !== 'totp') throw new Error('请选择两步验证备份文件')
    const count = await importSitesPayload(result.payload)
    await load()
    const warning = result.warnings.length ? `；${result.warnings.join('；')}` : ''
    ElMessage.success(
      result.source === 'legacy-totp-v2'
        ? `已导入旧版加密备份中的 ${count} 条${warning}`
        : `已导入 ${count} 条（同名/同 id 已合并）${warning}`,
    )
  } catch (e) {
    ElMessage.error(`导入失败：${String(e)}`)
  }
}

function applyQrResult(parsed: QrParseResult, pageOrigin?: string): void {
  form.value.secret = parsed.secret.replace(/\s/g, '').toUpperCase()
  if (parsed.name && !form.value.name.trim()) {
    form.value.name = parsed.name.replace(/^\/+/, '').trim()
  }
  // 域名必填且需 http(s) 前缀：扫码/页面识别时自动补全
  if (!form.value.domain.trim()) {
    const candidate =
      (parsed.url && hasHttpPrefix(parsed.url) ? parsed.url : '') ||
      (parsed.domain ? ensureHttpPrefix(parsed.domain) : '') ||
      (pageOrigin ? ensureHttpPrefix(pageOrigin) : '') ||
      (parsed.url ? ensureHttpPrefix(parsed.url) : '')
    if (candidate) form.value.domain = candidate.replace(/\/$/, '')
  } else if (!hasHttpPrefix(form.value.domain)) {
    form.value.domain = ensureHttpPrefix(form.value.domain)
  }
  onSecretInput()
}

function openAddDialog() {
  editingId.value = null
  form.value = { ...emptyForm(), category: currentTab.value }
  dialogVisible.value = true
}

function resetForm() {
  editingId.value = null
  form.value = emptyForm()
}

function editSite(site: TotpSite) {
  editingId.value = site.id
  // 编辑时优先展示带协议的完整网址
  const domainDisplay =
    (site.url && hasHttpPrefix(site.url) ? site.url : '') ||
    (site.domain ? ensureHttpPrefix(site.domain) : '') ||
    ''
  form.value = {
    name: site.name || '',
    domain: domainDisplay,
    secret: site.secret,
    category: getCategory(site),
  }
  dialogVisible.value = true
}

async function onSave() {
  const parsed = parseHostInput(form.value.domain)
  if (!parsed.ok) {
    ElMessage.warning('请填写合法域名，且必须以 http:// 或 https:// 开头')
    return
  }
  if (!/^[A-Z2-7]+=*$/i.test(form.value.secret.replace(/\s/g, ''))) {
    ElMessage.warning('请填写合法 Base32 密钥')
    return
  }
  saving.value = true
  try {
    const now = new Date().toISOString()
    const list = [...sites.value]
    const hostName = parsed.domain || ''
    const displayName = form.value.name.trim() || hostName || '未命名'
    const payload: TotpSite = {
      id: editingId.value || crypto.randomUUID(),
      name: displayName,
      secret: form.value.secret.replace(/\s/g, '').toUpperCase(),
      url: parsed.url,
      domain: parsed.domain,
      category: form.value.category,
      group: form.value.category,
      createdAt: editingId.value
        ? list.find((s) => s.id === editingId.value)?.createdAt || now
        : now,
      updatedAt: now,
    }
    if (editingId.value) {
      const i = list.findIndex((s) => s.id === editingId.value)
      if (i >= 0) list[i] = { ...list[i], ...payload }
    } else {
      list.push(payload)
    }
    await saveSites(list)
    sites.value = list
    await refreshCodes()
    ElMessage.success('已保存')
    dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function onCardMenu(cmd: string, site: TotpSite) {
  if (cmd === 'edit') editSite(site)
  else if (cmd === 'toggle-category') await toggleCategory(site)
  else if (cmd === 'delete') await onDelete(site)
}

async function toggleCategory(site: TotpSite) {
  const next: TabKey = getCategory(site) === 'pt' ? 'custom' : 'pt'
  const list = sites.value.map((s) =>
    s.id === site.id
      ? { ...s, category: next, group: next, updatedAt: new Date().toISOString() }
      : s,
  )
  await saveSites(list)
  sites.value = list
  ElMessage.success(next === 'pt' ? '已移到 PT站点' : '已移到自定义')
}

async function onDelete(site: TotpSite) {
  try {
    await confirmDelete(`确认删除「${site.name}」的两步验证？`)
  } catch {
    return
  }
  const list = sites.value.filter((x) => x.id !== site.id)
  await saveSites(list)
  sites.value = list
  ElMessage.success('已删除')
}

async function copyCode(site: TotpSite) {
  const code = codes.value[site.id]
  if (!code || code === 'ERROR') return
  try {
    await navigator.clipboard.writeText(code.replace(/\s/g, ''))
    ElMessage.success('已复制验证码')
  } catch {
    ElMessage.info(code)
  }
}

function openSite(site: TotpSite) {
  const url = siteUrl(site)
  if (!url) return
  try {
    chrome.tabs.create({ url })
  } catch {
    window.open(url, '_blank')
  }
}

/** 识别当前活动标签页中的二维码或 otpauth 链接。 */
async function scanFromActiveTab(): Promise<void> {
  if (scanningPage.value) return
  scanningPage.value = true
  try {
    const { pageOrigin, result } = await extractQrFromActiveTab()
    // 先用当前页 origin（已含协议）预填域名
    if (pageOrigin && !form.value.domain.trim()) {
      form.value.domain = ensureHttpPrefix(pageOrigin)
    }
    if (!result) {
      ElMessage.warning('未在当前页面检测到二维码或 otpauth 链接')
      return
    }
    if (result.type === 'otpauth') {
      const parsed = parseQrPayload(result.data)
      if (!parsed?.secret) {
        ElMessage.error('识别到 otpauth，但解析失败')
        return
      }
      applyQrResult(parsed, pageOrigin)
      ElMessage.success('已识别 otpauth 链接并自动填入密钥')
      return
    }
    if (result.type === 'image') {
      const parsed = await parseQrFromImageSrc(result.data)
      if (!parsed?.secret) {
        ElMessage.error('未检测到有效二维码')
        return
      }
      applyQrResult(parsed, pageOrigin)
      ElMessage.success('二维码解析成功')
      return
    }
    if (result.type === 'image-url') {
      try {
        const dataUrl = await fetchImageAsDataUrl(result.data)
        const parsed = await parseQrFromImageSrc(dataUrl)
        if (!parsed?.secret) {
          ElMessage.error('未检测到有效二维码')
          return
        }
        applyQrResult(parsed, pageOrigin)
        ElMessage.success('二维码解析成功')
        return
      } catch (e) {
        console.error('跨域获取二维码失败:', e)
        ElMessage.warning('未能识别二维码')
        return
      }
    }
    ElMessage.warning('未能识别二维码')
  } catch (e) {
    console.error('识别二维码失败:', e)
    const msg = e instanceof Error ? e.message : String(e)
    // 内部页/权限类错误：友好提示，避免把 chrome:// 原始异常直接抛给用户
    if (/浏览器内部页|chrome:\/\/|edge:\/\/|cannot be scripted/i.test(msg)) {
      ElMessage.warning(
        msg.includes('浏览器内部页')
          ? msg
          : '当前标签页为浏览器内部页，无法识别二维码。请先打开含二维码的站点页面后再试',
      )
    } else {
      ElMessage.error(`识别二维码失败：${msg}`)
    }
  } finally {
    scanningPage.value = false
  }
}

/** 上传本地二维码图片并解析 TOTP 密钥。 */
async function uploadQrImage(): Promise<void> {
  if (scanningUpload.value) return
  const files = await requestFilesFromActivePage({
    action: 'totp:qr-image',
    view: 'totp',
    accept: 'image/*',
    title: '选择二维码图片',
  })
  if (files[0]) await importQrImageFile(files[0])
}

async function importQrImageFile(item: PickedPageFile): Promise<void> {
  scanningUpload.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取二维码图片失败'))
      reader.readAsDataURL(new Blob([item.bytes], { type: item.type }))
    })
    const parsed = await parseQrFromImageSrc(dataUrl)
    if (!parsed?.secret) {
      ElMessage.error('未检测到有效二维码或内容不符合要求')
      return
    }
    if (!dialogVisible.value) {
      editingId.value = null
      form.value = { ...emptyForm(), category: currentTab.value }
      dialogVisible.value = true
    }
    applyQrResult(parsed)
    ElMessage.success('二维码解析成功')
  } catch (e) {
    ElMessage.error(`二维码解析失败：${String(e)}`)
  } finally {
    scanningUpload.value = false
  }
}

onMounted(async () => {
  await load()
  const [jsonFiles, qrImages] = await Promise.all([
    consumePickedPageFiles('totp:json'),
    consumePickedPageFiles('totp:qr-image'),
  ])
  if (jsonFiles[0]) await importTotpFile(jsonFiles[0])
  if (qrImages[0]) await importQrImageFile(qrImages[0])
  startTimer()
})
onBeforeUnmount(stopTimer)
</script>

<style scoped>
.totp-manager {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  /* AppShell .mp-view--flush：顶部固定，列表区内部滚动 */
}

.toolbar {
  padding: 10px 10px 8px;
  background: var(--mp-color-surface, #ffffff);
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 0;
  box-sizing: border-box;
  flex: 0 0 auto;
}

.toolbar-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  --tb-control-h: 28px;
}

.search-input {
  flex: 1;
  min-width: 0;
}

.search-input :deep(.el-input__wrapper) {
  height: var(--tb-control-h) !important;
  min-height: var(--tb-control-h) !important;
  max-height: var(--tb-control-h) !important;
  padding: 0 11px !important;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
  background: #f8fafc;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.search-input :deep(.el-input__inner) {
  height: 100% !important;
  line-height: 1.2 !important;
}

.search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #1677ff inset !important;
  background: #ffffff;
}

.compact {
  width: var(--tb-control-h, 28px);
  height: var(--tb-control-h, 28px);
  padding: 0 !important;
  border-radius: 8px;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid #e2e8f0 !important;
  background: #ffffff !important;
  color: #475569 !important;
  margin: 0 !important;
  box-sizing: border-box;
}

.add-button {
  background: #1677ff !important;
  border-color: #1677ff !important;
  color: #ffffff !important;
}

.add-button:hover {
  background: #0050b3 !important;
  border-color: #0050b3 !important;
  color: #ffffff !important;
}

.more-button:hover,
.sort-button:hover {
  background: #f1f5f9 !important;
  border-color: #cbd5e1 !important;
  color: #0f172a !important;
}

.icon-prefix {
  color: #64748b;
  fill: currentColor;
}

.icon-btn-only {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.dropdown-item-content {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}



.mr-1 {
  width: 14px;
  height: 14px;
  fill: currentColor;
  flex-shrink: 0;
}

.totp-tabs {
  display: flex;
  background: var(--mp-color-surface, #ffffff);
  border-bottom: 1px solid #e2e8f0;
  padding: 0;
  flex: 0 0 auto;
  flex-shrink: 0;
  box-sizing: border-box;
}

.totp-tab-item {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  position: relative;
  transition: color 0.15s ease;
  user-select: none;
}

.totp-tab-item:hover {
  color: #0f172a;
}

.totp-tab-item.active {
  color: #1677ff;
  font-weight: 600;
}

.totp-tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 16px;
  right: 16px;
  height: 2px;
  background: #1677ff;
  border-radius: 2px 2px 0 0;
}

.totp-grid {
  min-width: 0;
  padding: 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  box-sizing: border-box;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  align-content: start;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #999;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.5;
  fill: currentColor;
  color: #94a3b8;
}

.empty-state :deep(.el-button--small) {
  height: 30px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
}

.empty-text {
  margin: 0 0 16px;
  font-size: 15px;
  color: #64748b;
}

.totp-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.totp-loading-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.totp-loading-card {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
  padding: 12px;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}

.totp-loading-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.totp-loading-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}

.totp-loading-info {
  flex: 1;
  min-width: 0;
}

.totp-loading-line {
  height: 9px;
  border-radius: 999px;
}

.totp-loading-line.name {
  width: 58%;
  height: 12px;
  margin-bottom: 7px;
}

.totp-loading-line.domain {
  width: 76%;
}

.totp-loading-actions {
  display: flex;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.totp-loading-action {
  width: 31px;
  height: 28px;
}

.totp-loading-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
}

.totp-loading-code {
  width: 112px;
  max-width: 60%;
  height: 18px;
  border-radius: 999px;
}

.totp-loading-timer {
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.totp-loading-shimmer {
  background: linear-gradient(90deg, #edf2f7 25%, #f8fafc 37%, #edf2f7 63%);
  background-size: 400% 100%;
  animation: totp-loading-shimmer 1.25s ease-in-out infinite;
}

@keyframes totp-loading-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}

.totp-card {
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
  padding: 12px;
  display: flex;
  flex-direction: column;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.totp-card:hover {
  border-color: rgba(22, 119, 255, 0.3);
  box-shadow:
    0 4px 12px rgba(22, 119, 255, 0.06),
    0 1px 3px rgba(0, 0, 0, 0.02);
  transform: translateY(-1px);
}

.card-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.site-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.site-avatar.has-icon {
  background: transparent !important;
  box-shadow: none;
  text-shadow: none;
  color: inherit;
}

.site-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: inherit;
  background: transparent;
}

.site-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.site-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  text-align: left;
}

.site-domain {
  font-size: 11px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.domain-icon {
  flex-shrink: 0;
  fill: currentColor;
  opacity: 0.9;
}

.domain-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-domain.link-style {
  color: #1677ff;
  cursor: pointer;
}

.site-domain.link-style:hover {
  color: #0050b3;
}

.site-domain.link-style:hover .domain-text {
  text-decoration: underline;
}

.card-actions {
  display: flex;
  gap: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.action-btn {
  padding: 6px 8px !important;
  height: 28px !important;
  width: auto !important;
  min-width: 30px !important;
  border: none !important;
  background: transparent !important;
  color: #475569 !important;
  border-radius: 0 !important;
  margin: 0 !important;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: #f1f5f9 !important;
  color: #16a34a !important;
}

.action-btn svg {
  fill: currentColor;
}

.text-danger {
  color: #ef4444;
}

.card-code-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
  font-size: 11px;
}

.code-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 22px;
}

.code-label {
  color: #94a3b8;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 22px;
}

.code-value {
  /* 浅蓝色 */
  color: #60a5fa;
  cursor: pointer;
  transition: color 0.15s ease;
  user-select: none;
}

/* 圆润等宽数字：系统 UI 圆角风格 */
.code-value--round {
  font-family:
    'SF Pro Rounded',
    'Hiragino Sans GB',
    'PingFang SC',
    'Segoe UI',
    'Avenir Next',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-size: 17px;
  font-weight: 700;
  line-height: 22px;
  letter-spacing: 0.14em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  display: inline-block;
}

.code-value:hover,
.code-value--round:hover {
  color: #3b82f6;
}

.code-value.loading {
  color: #94a3b8;
  opacity: 0.7;
  animation: pulse 1.5s ease-in-out infinite;
}

.code-value.error {
  color: #ef4444;
  opacity: 0.85;
}

:global(html[data-theme='dark']) .code-value--round {
  color: #93c5fd;
}

:global(html[data-theme='dark']) .code-value--round:hover {
  color: #bfdbfe;
}

:global(html[data-theme='dark']) .code-value.loading {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .code-value.error {
  color: #f87171;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}

.circular-timer {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.timer-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.timer-bg {
  fill: none;
  /* 与进度环同色系的浅底轨 */
  stroke: #bfdbfe;
  stroke-width: 3;
}

.timer-progress {
  fill: none;
  /* 与验证码浅蓝色统一：#60a5fa */
  stroke: #60a5fa;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s ease;
}

.timer-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: #60a5fa;
  font-variant-numeric: tabular-nums;
}

/* 暗色主题 */
:global(html[data-theme='dark']) .toolbar,
:global(html[data-theme='dark']) .totp-tabs {
  background: var(--mp-color-surface, #1e293b);
  border-bottom-color: #334155;
}

:global(html[data-theme='dark']) .search-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px #334155 inset;
}

:global(html[data-theme='dark']) .compact {
  background: var(--mp-color-surface, #1e293b) !important;
  border-color: #334155 !important;
  color: #cbd5e1 !important;
}

:global(html[data-theme='dark']) .add-button {
  background: #1677ff !important;
  border-color: #1677ff !important;
  color: #fff !important;
}

:global(html[data-theme='dark']) .more-button:hover,
:global(html[data-theme='dark']) .sort-button:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: #475569 !important;
  color: #e2e8f0 !important;
}

:global(html[data-theme='dark']) .totp-tab-item {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .totp-tab-item:hover {
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .totp-tab-item.active {
  color: #60a5fa;
}

:global(html[data-theme='dark']) .totp-tab-item.active::after {
  background: #60a5fa;
}

:global(html[data-theme='dark']) .totp-card,
:global(html[data-theme='dark']) .totp-loading-card {
  background: var(--mp-color-card, #1e293b);
  border-color: #334155;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

:global(html[data-theme='dark']) .totp-card:hover {
  border-color: rgba(96, 165, 250, 0.35);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(96, 165, 250, 0.1);
}

:global(html[data-theme='dark']) .site-name {
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .site-domain {
  color: #94a3b8;
}

:global(html[data-theme='dark']) .site-domain.link-style {
  color: #60a5fa;
}

:global(html[data-theme='dark']) .card-actions {
  background: rgba(255, 255, 255, 0.04);
  border-color: #334155;
}

:global(html[data-theme='dark']) .action-btn {
  color: #94a3b8 !important;
}

:global(html[data-theme='dark']) .action-btn:hover {
  background: rgba(255, 255, 255, 0.06) !important;
  color: #4ade80 !important;
}

:global(html[data-theme='dark']) .card-code-row {
  border-top-color: #334155;
}

:global(html[data-theme='dark']) .code-value {
  color: #60a5fa;
}

:global(html[data-theme='dark']) .timer-bg {
  stroke: rgba(147, 197, 253, 0.28);
}

:global(html[data-theme='dark']) .timer-progress {
  stroke: #93c5fd;
}

:global(html[data-theme='dark']) .timer-text {
  color: #93c5fd;
}

:global(html[data-theme='dark']) .totp-loading-shimmer {
  background: linear-gradient(90deg, #374151 25%, #4b5563 37%, #374151 63%);
  background-size: 400% 100%;
}

:global(html[data-theme='dark']) .empty-text {
  color: #94a3b8;
}

/* 二级弹窗 */
:global(.el-overlay:has(.mp-sub-dialog)) {
  overflow: auto !important;
}

:global(.el-overlay:has(.mp-sub-dialog) .el-overlay-dialog) {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: center !important;
  overflow: visible !important;
  padding: 24px 0 !important;
  box-sizing: border-box !important;
}

:global(.mp-sub-dialog.el-dialog) {
  width: 92% !important;
  max-width: 348px;
  height: auto !important;
  max-height: calc(100vh - 48px) !important;
  margin: 0 auto !important;
  border-radius: 12px;
  overflow: hidden;
  display: flex !important;
  flex-direction: column;
  position: relative !important;
  top: auto !important;
}

:global(.mp-sub-dialog .el-dialog__header) {
  flex: 0 0 auto;
  margin-right: 0;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

:global(.mp-sub-dialog .el-dialog__title) {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}

:global(.mp-sub-dialog .el-dialog__headerbtn) {
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
}

:global(.mp-sub-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 14px 6px;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: none !important;
  height: auto !important;
}

:global(.mp-sub-dialog .el-dialog__footer) {
  flex: 0 0 auto;
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  background: inherit
}

.mp-sub-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px !important;
  line-height: 1.25;
  padding: 0;
  height: auto;
}

.mp-sub-control {
  width: 100%;
}

.mp-sub-form :deep(.el-input--small .el-input__wrapper),
.mp-sub-form :deep(.el-select--small .el-select__wrapper) {
  height: 30px !important;
  min-height: 30px !important;
  max-height: 30px !important;
  box-sizing: border-box !important;
  border-radius: 8px;
}

.mp-sub-form :deep(.el-input__wrapper),
.mp-sub-form :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

.mp-sub-form :deep(.el-input__wrapper.is-focus),
.mp-sub-form :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #1677ff inset !important;
}

.mp-sub-form :deep(.el-textarea__inner) {
  font-size: 12px;
  line-height: 1.45;
  min-height: 64px !important;
  padding: 8px 10px;
  resize: vertical;
}

.mp-sub-radio :deep(.el-radio) {
  margin-right: 16px;
  height: 30px;
}

.mp-sub-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.mp-sub-footer :deep(.el-button) {
  min-width: 72px;
  height: 30px;
  border-radius: 8px;
  font-size: 12px;
  padding: 0 14px;
}

/* 密钥 + 获取：去掉输入框右侧圆角，与 append 无缝拼接 */
.mp-sub-form :deep(.secret-input.el-input-group) {
  display: flex;
  align-items: stretch;
  width: 100%;
}

.mp-sub-form :deep(.secret-input .el-input__wrapper) {
  border-radius: 8px 0 0 8px !important;
  /* 右侧边框交给 append，避免双线 */
  box-shadow:
    0 1px 0 0 #e2e8f0 inset,
    0 -1px 0 0 #e2e8f0 inset,
    1px 0 0 0 #e2e8f0 inset !important;
}

.mp-sub-form :deep(.secret-input .el-input__wrapper.is-focus) {
  box-shadow:
    0 1px 0 0 #1677ff inset,
    0 -1px 0 0 #1677ff inset,
    1px 0 0 0 #1677ff inset !important;
  z-index: 1;
}

.mp-sub-form :deep(.secret-input .el-input-group__append) {
  padding: 0;
  margin: 0;
  background: #f8fafc;
  border: none;
  box-shadow:
    0 1px 0 0 #e2e8f0 inset,
    0 -1px 0 0 #e2e8f0 inset,
    -1px 0 0 0 #e2e8f0 inset,
    1px 0 0 0 #e2e8f0 inset !important;
  border-radius: 0 8px 8px 0;
  overflow: hidden;
  display: inline-flex;
  align-items: stretch;
}

.mp-sub-form :deep(.secret-input.is-focus .el-input-group__append),
.mp-sub-form :deep(.secret-input .el-input__wrapper.is-focus + .el-input-group__append) {
  box-shadow:
    0 1px 0 0 #1677ff inset,
    0 -1px 0 0 #1677ff inset,
    -1px 0 0 0 #1677ff inset,
    1px 0 0 0 #1677ff inset !important;
}

.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn.el-button) {
  margin: 0;
  border: none;
  border-radius: 0;
  height: 30px;
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  /* 略浅，避免 append 区显得过重 */
  color: #64748b;
  background: transparent;
  box-shadow: none;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: 1 !important;
}

/* Element Plus 会把默认 slot 包进 span；强制该容器 flex 垂直居中 */
.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn.el-button > span) {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px;
  line-height: 1 !important;
  height: 100%;
}

/* 图标与文字间距 + 垂直居中 */
.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn .secret-append-icon) {
  fill: currentColor;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin: 0 !important;
  display: block;
  opacity: 0.85;
}

.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn .secret-get-text) {
  margin: 0 !important;
  line-height: 1 !important;
  letter-spacing: 0.02em;
  display: inline-block;
}

.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn.el-button:hover) {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.06);
}

.mp-sub-form :deep(.secret-input .el-input-group__append .secret-get-btn.el-button:active) {
  background: rgba(59, 130, 246, 0.1);
}

.secret-append-icon {
  fill: currentColor;
  flex-shrink: 0;
}

.qr-upload-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
}

.qr-upload-hint {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.35;
}

:global(html[data-theme='dark'] .mp-sub-dialog.el-dialog) {
  background: #1e293b;
  border: 1px solid #334155;
}

:global(html[data-theme='dark'] .mp-sub-form .secret-input .el-input__wrapper) {
  box-shadow:
    0 1px 0 0 #475569 inset,
    0 -1px 0 0 #475569 inset,
    1px 0 0 0 #475569 inset !important;
}

:global(html[data-theme='dark'] .mp-sub-form .secret-input .el-input__wrapper.is-focus) {
  box-shadow:
    0 1px 0 0 #3b82f6 inset,
    0 -1px 0 0 #3b82f6 inset,
    1px 0 0 0 #3b82f6 inset !important;
}

:global(html[data-theme='dark'] .mp-sub-form .secret-input .el-input-group__append) {
  background: #0f172a;
  box-shadow:
    0 1px 0 0 #475569 inset,
    0 -1px 0 0 #475569 inset,
    -1px 0 0 0 #475569 inset,
    1px 0 0 0 #475569 inset !important;
}

:global(html[data-theme='dark'] .mp-sub-form .secret-input .el-input-group__append .secret-get-btn.el-button) {
  color: #94a3b8;
}

:global(html[data-theme='dark'] .mp-sub-form .secret-input .el-input-group__append .secret-get-btn.el-button:hover) {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.12);
}

:global(html[data-theme='dark'] .mp-sub-dialog .el-dialog__header),
:global(html[data-theme='dark'] .mp-sub-dialog .el-dialog__footer) {
  border-color: rgba(148, 163, 184, 0.14);
}

:global(html[data-theme='dark'] .mp-sub-dialog .el-dialog__title) {
  color: #f1f5f9;
}

:global(html[data-theme='dark']) .mp-sub-form :deep(.el-form-item__label) {
  color: #cbd5e1;
}

:global(html[data-theme='dark']) .mp-sub-form :deep(.el-input__wrapper),
:global(html[data-theme='dark']) .mp-sub-form :deep(.el-textarea__inner) {
  background: #0f172a;
  box-shadow: 0 0 0 1px #334155 inset !important;
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .mp-sub-form :deep(.el-input__wrapper.is-focus),
:global(html[data-theme='dark']) .mp-sub-form :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #60a5fa inset !important;
}
</style>
