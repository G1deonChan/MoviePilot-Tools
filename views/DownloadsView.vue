<template>
  <div class="download-manager">
    <template v-if="loadingClients">
      <div class="download-loading-state">
        <div class="download-loading-spinner"></div>
        <div class="download-loading-title">正在加载下载器</div>
        <div class="download-loading-desc">请稍候，正在读取下载器配置...</div>
      </div>
    </template>

    <div v-else-if="downloaders.length > 0" class="action-bar">
      <el-select
        v-model="activeDownloader"
        placeholder="选择下载器"
        size="small"
        class="downloader-select"
        @change="onDownloaderChange"
      >
        <el-option
          v-for="d in downloaders"
          :key="d.name"
          :label="d.name"
          :value="d.name"
        />
      </el-select>
      <div class="action-buttons">
        <el-button size="small" type="default" :loading="refreshing" @click="loadDownloads">
          <el-icon class="btn-ico"><Refresh /></el-icon>
          刷新
        </el-button>
        <el-dropdown trigger="click" @command="onAddDownloadCommand">
          <el-button size="small" type="primary">
            <el-icon class="btn-ico"><Plus /></el-icon>
            添加下载
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="torrent">
                <el-icon><Document /></el-icon>
                种子链接
              </el-dropdown-item>
              <el-dropdown-item command="magnet">
                <el-icon><Link /></el-icon>
                磁力链接
              </el-dropdown-item>
              <el-dropdown-item command="site">
                <el-icon><Download /></el-icon>
                站点下载
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div v-if="!loadingClients && downloaders.length > 0 && activeDownloader" class="download-content">
      <div class="download-list">
        <div v-if="isFirstLoad && downloads.length === 0" class="download-checking-state">
          <div class="download-checking-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="download-checking-title">正在检查下载任务</div>
          <div class="download-checking-desc">加载完成后将显示下载任务或空状态</div>
        </div>

        <div v-else-if="downloads.length > 0" class="download-items">
          <!-- 下载卡片使用海报背景、渐变遮罩和白色信息文字。 -->
          <div
            v-for="item in downloads"
            :key="item.hash"
            class="dl-card"
            :class="[`is-${stateOf(item) || 'unknown'}`]"
          >
            <div
              class="dl-card-bg"
              :style="posterStyle(item)"
              aria-hidden="true"
            />
            <div class="dl-card-shade" aria-hidden="true" />

            <div class="dl-card-body">
              <!-- 标题与状态同行；描述单独整行，避免被右上角标签挤窄 -->
              <div class="dl-card-top">
                <div class="dl-title-row">
                  <div class="dl-title" :title="displayTitle(item)">
                    {{ displayTitle(item) }}
                    <span v-if="episodeLabelOf(item)" class="dl-episode">
                      {{ episodeLabelOf(item) }}
                    </span>
                  </div>
                  <span
                    class="dl-status"
                    :class="[
                      `dl-status--${stateOf(item) || 'unknown'}`,
                      { 'is-dot-only': isStatusDotOnly(item) },
                    ]"
                    :title="statusTextOf(item)"
                    :aria-label="statusTextOf(item)"
                  >
                    <i class="dl-status-dot" aria-hidden="true" />
                    <span v-if="!isStatusDotOnly(item)" class="dl-status-text">
                      {{ statusTextOf(item) }}
                    </span>
                  </span>
                </div>
                <div class="dl-subtitle" :title="item.title || item.name">
                  {{ item.title || item.name }}
                </div>
              </div>

              <div class="dl-meta">
                {{ speedLineOf(item) }}
              </div>

              <!-- 此处只显示进度条；百分比和剩余时间显示在速度信息行。 -->
              <div v-if="normalizeProgress(item.progress) > 0" class="dl-progress">
                <el-progress
                  :percentage="normalizeProgress(item.progress)"
                  :stroke-width="5"
                  :color="progressColorOf(item)"
                  :show-text="false"
                />
              </div>

              <div class="dl-actions">
                <button
                  type="button"
                  class="dl-act"
                  :class="{
                    'is-pause': isDownloading(item),
                    'is-loading': !!actionLoading[item.hash],
                  }"
                  :disabled="!!actionLoading[item.hash]"
                  :title="isDownloading(item) ? '暂停' : '开始'"
                  @click="toggleDownload(item)"
                >
                  <!-- 暂停和继续操作使用对应状态图标。 -->
                  <svg class="dl-act-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="isDownloading(item) ? mdiPause : mdiPlay" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="dl-act is-danger"
                  :class="{ 'is-loading': !!actionLoading[item.hash] }"
                  :disabled="!!actionLoading[item.hash]"
                  title="删除"
                  @click="deleteDownload(item)"
                >
                  <!-- 删除操作使用垃圾桶轮廓图标。 -->
                  <svg class="dl-act-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="mdiTrashCanOutline" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty">
          <el-empty description="暂无下载任务" />
        </div>
      </div>
    </div>

    <div v-else-if="!loadingClients" class="no-downloader">
      <el-empty description="未配置下载器">
        <el-button type="primary" @click="onOpenWeb">前往配置</el-button>
      </el-empty>
    </div>

    <!-- 添加下载对话框（ AddDownloadDialog 样式） -->
    <el-dialog
      v-model="showAddDownload"
      width="92%"
      :title="dialogTitle"
      :close-on-click-modal="false"
      append-to-body
      :align-center="false"
      class="add-download-dialog"
      @closed="resetAddForm"
    >
      <div class="add-dl-form">
        <el-form label-position="top">
          <el-form-item :label="inputLabel" required>
            <el-input
              v-model="inputValue"
              :type="downloadType === 'site' ? 'text' : 'textarea'"
              :rows="downloadType === 'site' ? undefined : 3"
              :placeholder="inputPlaceholder"
              class="add-dl-input"
            />
          </el-form-item>
          <div class="add-dl-row-two">
            <el-form-item label="下载器" class="add-dl-half">
              <el-select
                v-model="addDownloader"
                size="small"
                placeholder="请选择下载器"
                class="add-dl-control"
              >
                <el-option
                  v-for="item in downloaders"
                  :key="item.name"
                  :label="item.name"
                  :value="item.name"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="下载任务标签" class="add-dl-half">
              <el-input
                v-model="downloadLabel"
                size="small"
                placeholder="请输入标签，多个标签用逗号分隔"
                class="add-dl-control"
              />
            </el-form-item>
          </div>
          <el-form-item label="下载目录">
            <el-select
              v-model="savePath"
              size="small"
              placeholder="请选择下载目录"
              clearable
              class="add-dl-control"
            >
              <el-option
                v-for="dir in directories"
                :key="dir.name + (dir.save_path || dir.download_path)"
                :label="`${dir.name} (${dir.download_path})`"
                :value="dir.save_path || dir.download_path"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <div class="add-dl-footer">
          <el-button @click="showAddDownload = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="onSubmitAdd">
            {{ downloadType === 'site' ? '确定下载' : '直接添加' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
// 下载管理： DownloadManager + ListView + Item + 简化添加对话框
import { ref, computed, onMounted, onUnmounted, watch, reactive } from 'vue'
import {
  Refresh,
  Plus,
  ArrowDown,
  Document,
  Link,
  Download,
} from '@element-plus/icons-vue'
// 下载操作图标：mdi-play / mdi-pause / mdi-trash-can-outline
import { mdiPlay, mdiPause, mdiTrashCanOutline } from '@mdi/js'
import {
  fetchClients,
  fetchTasks,
  startDownload,
  stopDownload,
  deleteTask,
  addDownload,
  fetchDirectories,
  resolveSiteTorrent,
} from '../services/download'
import { fetchSites, fetchSupporting } from '../services/site-manage'
import { loadCustomDomainAliases } from '../services/site-domain-alias'
import { buildSiteTorrent, findConfiguredSiteForUrl } from '../services/site-torrent'
import type { DownloadClient, DownloadTask, DownloadDirectory } from '../core/types'
import { STORAGE_KEYS, storageGet, storageRemove } from '../core/storage'
import { getActiveBaseUrl } from '../core/auth-session'
import { ElMessage, confirmAction, confirmDelete } from '../utils/ui'
import { formatFileSize } from '../utils/format'
import {
  directDownloadMagnet,
  directDownloadTorrentUrl,
  isMediaRecognitionFailure,
} from '../services/direct-download'

 type DownloadType = 'torrent' | 'magnet' | 'site'

const downloaders = ref<DownloadClient[]>([])
const activeDownloader = ref('')
const downloads = ref<DownloadTask[]>([])
const loadingClients = ref(true)
const refreshing = ref(false)
const isFirstLoad = ref(true)
const actionLoading = reactive<Record<string, boolean>>({})
/** 乐观本地状态 hash → state */
const localState = reactive<Record<string, string>>({})

const showAddDownload = ref(false)
const downloadType = ref<DownloadType>('torrent')
const inputValue = ref('')
const addDownloader = ref('')
const savePath = ref('')
const downloadLabel = ref('MOVIEPILOT')
const sitePageTitle = ref('')
const submitting = ref(false)
const directories = ref<DownloadDirectory[]>([])

let refreshTimer: ReturnType<typeof setInterval> | null = null

// 工具
/**
 * 统一进度为 0–100。
 * MP 后端约定：qB/rtorrent 已是百分比；极少数 0–1 小数（且 >1% 场景下不会落在 ≤1）不二次放大。
 * 文字与进度条必须共用本函数，避免显示不一致。
 */
function normalizeProgress(progress?: number | string | null): number {
  if (progress == null || progress === '') return 0
  const n = typeof progress === 'number' ? progress : Number(progress)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n >= 100) return 100
  // 仅当值非常小的“看起来像比例”且状态接近完成时不在此处理；
  // 接口值按 0–100 百分比使用（0.5 表示 0.5%，不是 50%）
  return Math.min(100, Math.max(0, n))
}



function speedText(v?: number | string): string {
  if (v == null || v === '') return '0 B/s'
  if (typeof v === 'string') {
    // 已格式化则补 /s 或原样
    if (/\/s$/i.test(v)) return v
    if (/[KMGTkmgt]?B/.test(v)) return `${v}/s`
    const n = Number(v)
    if (!Number.isNaN(n)) return `${formatFileSize(n)}/s`
    return v
  }
  return `${formatFileSize(v)}/s`
}

function stateOf(item: DownloadTask): string {
  return localState[item.hash] ?? item.state ?? ''
}

function isDownloading(item: DownloadTask): boolean {
  return stateOf(item) === 'downloading'
}

function displayTitle(item: DownloadTask): string {
  return item.media?.title || item.name || item.title || '未知任务'
}

/** 季集标签：优先 media.season + episode，否则 season_episode */
function episodeLabelOf(item: DownloadTask): string {
  const se = item.media?.season
  const ep = item.media?.episode
  if (se || ep) return [se, ep].filter(Boolean).join(' ')
  return (item.season_episode || '').trim()
}

/** 体积 ↑上传 ↓下载 剩余时间 */
function speedLineOf(item: DownloadTask): string {
  const size = formatFileSize(item.size)
  const up = speedText(item.upspeed).replace(/\/s$/i, '')
  const down = speedText(item.dlspeed).replace(/\/s$/i, '')
  const left = (item.left_time || '').trim()
  return `${size}  ↑ ${up}/s  ↓ ${down}/s${left ? `  ${left}` : ''}`
}

function posterStyle(item: DownloadTask): Record<string, string> {
  const img = item.media?.image
  if (img) {
    return {
      backgroundImage: `url("${img}")`,
    }
  }
  return {}
}

const PROGRESS_COLORS: Record<string, string> = {
  downloading: '#4ade80',
  paused: '#fbbf24',
  error: '#f87171',
  completed: '#94a3b8',
}
function progressColorOf(item: DownloadTask): string {
  return PROGRESS_COLORS[stateOf(item)] || '#4ade80'
}

const STATUS_TEXTS: Record<string, string> = {
  downloading: '下载中',
  paused: '已暂停',
  error: '错误',
  completed: '已完成',
}
function statusTextOf(item: DownloadTask): string {
  return STATUS_TEXTS[stateOf(item)] || '未知'
}

/** 下载中 / 已暂停：只显示色点，文字放 title */
function isStatusDotOnly(item: DownloadTask): boolean {
  const s = stateOf(item)
  return s === 'downloading' || s === 'paused'
}

// 数据加载
async function loadDownloaders() {
  try {
    loadingClients.value = true
    downloaders.value = await fetchClients()
    if (downloaders.value.length > 0 && !activeDownloader.value) {
      activeDownloader.value = downloaders.value[0].name
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('加载下载器配置失败')
  } finally {
    loadingClients.value = false
  }
}

async function fetchList(first = false) {
  if (!activeDownloader.value) return
  if (first) isFirstLoad.value = true
  try {
    const data = await fetchTasks(activeDownloader.value)
    downloads.value = data
    // 同步乐观状态：若服务端已一致则清除
    for (const d of data) {
      if (localState[d.hash] && localState[d.hash] === d.state) {
        delete localState[d.hash]
      }
    }
  } catch (e) {
    console.error(e)
    if (first) ElMessage.error('加载下载任务失败')
  } finally {
    if (first) isFirstLoad.value = false
  }
}

async function loadDownloads() {
  try {
    refreshing.value = true
    await fetchList(false)
  } finally {
    refreshing.value = false
  }
}

function onDownloaderChange() {
  void fetchList(true)
  startAutoRefresh()
}

function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(() => {
    void fetchList(false)
  }, 5000)
}
function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

// 任务操作
async function toggleDownload(item: DownloadTask) {
  actionLoading[item.hash] = true
  const wasDownloading = isDownloading(item)
  try {
    const ok = wasDownloading
      ? await stopDownload(item.hash, activeDownloader.value)
      : await startDownload(item.hash, activeDownloader.value)
    if (ok) {
      localState[item.hash] = wasDownloading ? 'paused' : 'downloading'
      ElMessage.success(wasDownloading ? '已暂停' : '已开始')
      void fetchList(false)
    } else {
      ElMessage.error('操作失败')
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('操作失败')
  } finally {
    actionLoading[item.hash] = false
  }
}

async function deleteDownload(item: DownloadTask) {
  try {
    await confirmDelete('确定要删除这个下载任务吗？', {
      title: '确认删除',
      confirmButtonText: '确定',
    })
  } catch {
    return
  }
  actionLoading[item.hash] = true
  try {
    const ok = await deleteTask(item.hash, activeDownloader.value)
    if (ok) {
      ElMessage.success('删除成功')
      void fetchList(false)
    } else {
      ElMessage.error('删除失败')
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('删除失败')
  } finally {
    actionLoading[item.hash] = false
  }
}

async function onOpenWeb() {
  const base = await getActiveBaseUrl()
  if (base) {
    try {
      await chrome.tabs.create({ url: base })
    } catch {
      window.open(base, '_blank')
    }
  } else {
    ElMessage.warning('未配置服务器地址')
  }
}

// 添加下载
const dialogTitle = computed(() => {
  if (downloadType.value === 'torrent') return '添加种子链接'
  if (downloadType.value === 'magnet') return '添加磁力链接'
  if (downloadType.value === 'site') return 'PT站种子下载'
  return '添加下载'
})
const inputLabel = computed(() => {
  if (downloadType.value === 'torrent') return '下载链接'
  if (downloadType.value === 'magnet') return '磁力链接'
  if (downloadType.value === 'site') return 'PT站种子详情页链接'
  return '链接'
})
const inputPlaceholder = computed(() => {
  if (downloadType.value === 'torrent') return '请输入种子链接，每行一个\n支持 http/https 链接'
  if (downloadType.value === 'magnet') return '请输入磁力链接，每行一个\n格式：magnet:?xt=urn:btih:...'
  if (downloadType.value === 'site') return '请输入PT站种子详情页链接，如 details.php?id=xxxxx'
  return '请输入链接'
})

function onAddDownloadCommand(command: string) {
  downloadType.value = command as DownloadType
  addDownloader.value = activeDownloader.value
  showAddDownload.value = true
  void loadDirectories()
}

async function loadDirectories() {
  try {
    directories.value = await fetchDirectories()
  } catch {
    directories.value = []
  }
}

function resetAddForm() {
  inputValue.value = ''
  downloadLabel.value = 'MOVIEPILOT'
  sitePageTitle.value = ''
  savePath.value = ''
}

function extractTitleFromUrl(url: string): string {
  try {
    if (url.startsWith('magnet:?')) {
      const qs = new URLSearchParams(url.substring(8))
      const dn = qs.get('dn')
      if (dn) return decodeURIComponent(dn).replace(/[._]+/g, ' ').trim()
      return 'magnet'
    }
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname || '/')
    const base = path.split('/').filter(Boolean).pop() || u.hostname
    return base.replace(/\.(torrent|txt|html?)$/i, '').replace(/[._]+/g, ' ').trim() || u.hostname
  } catch {
    return url
  }
}

function directDownloadOptions(downloader: string) {
  return {
    downloader,
    savePath: savePath.value,
    labels: downloadLabel.value || undefined,
  }
}

async function confirmDirectFallback(title: string): Promise<boolean> {
  try {
    await confirmAction(
      `MoviePilot 无法识别“${title}”的媒体信息。\n\n是否跳过媒体识别，直接将种子任务提交到下载器？`,
      {
        title: '使用直接下载',
        kind: 'warning',
        confirmButtonText: '直接提交',
        cancelButtonText: '取消',
      },
    )
    return true
  } catch {
    return false
  }
}

/** 服务端明确要求确认时才允许跳过识别，取消不提交第二次请求。 */
async function confirmUnrecognized(title: string): Promise<boolean> {
  try {
    await confirmAction(`MoviePilot 无法识别“${title}”。是否按未识别资源继续下载？`, {
      title: '确认未识别资源', kind: 'warning', confirmButtonText: '继续下载', cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}

async function submitSiteDownload(pageUrl: string): Promise<boolean> {
  const [sites, supporting, aliases] = await Promise.all([
    fetchSites(),
    fetchSupporting(),
    loadCustomDomainAliases(),
  ])
  const site = findConfiguredSiteForUrl(pageUrl, sites, supporting, aliases)
  if (!site) throw new Error('未找到与该详情页匹配的 MoviePilot 站点配置')

  const resolved = await resolveSiteTorrent(site.id, pageUrl, sitePageTitle.value)
  if (!resolved.ok || !resolved.torrent) throw new Error(resolved.message || '未找到当前种子')
  const resource = resolved.torrent

  const torrent = buildSiteTorrent(
    resource,
    site,
    pageUrl,
    sitePageTitle.value || extractTitleFromUrl(pageUrl),
  )
  const downloader = addDownloader.value || torrent.site_downloader || site.downloader || ''
  if (!downloader) throw new Error('未找到可用下载器')
  const res = await addDownload({
    torrent_in: torrent,
    downloader: downloader || undefined,
    save_path: savePath.value || undefined,
  })
  if (res.ok) return true

  const reason = res.message || '添加失败'
  if (res.requiresConfirmation) {
    if (!(await confirmUnrecognized(torrent.title))) return false
    const confirmed = await addDownload({
      torrent_in: torrent, downloader, save_path: savePath.value || undefined, allow_unrecognized: true,
    })
    if (!confirmed.ok) throw new Error(confirmed.message || '添加失败')
    return true
  }
  if (!isMediaRecognitionFailure(reason)) throw new Error(reason)
  if (!(await confirmDirectFallback(torrent.title))) return false

  const direct = torrent.enclosure.startsWith('magnet:')
    ? await directDownloadMagnet(torrent.enclosure, directDownloadOptions(downloader))
    : await directDownloadTorrentUrl(torrent.enclosure, directDownloadOptions(downloader))
  if (!direct.ok) throw new Error(direct.error || '直接下载失败')
  return true
}

async function onSubmitAdd() {
  if (!inputValue.value.trim()) {
    ElMessage.error(
      downloadType.value === 'magnet'
        ? '请填写至少一个磁力链接'
        : downloadType.value === 'site'
          ? '请填写PT站种子详情页链接'
          : '请填写至少一个种子链接',
    )
    return
  }
  if (!addDownloader.value) {
    ElMessage.error('请选择下载器')
    return
  }
  if (!savePath.value) {
    ElMessage.error('请选择下载目录')
    return
  }
  submitting.value = true
  try {
    if (downloadType.value === 'site') {
      if (!(await submitSiteDownload(inputValue.value.trim()))) return
    } else {
      const lines = inputValue.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      let allOk = true
      for (const url of lines) {
        const title = extractTitleFromUrl(url)
        try {
          // v3 原生下载负责服务器端取种和任务登记，无需安装辅助插件。
          const payload = {
            torrent_in: { title, enclosure: url, labels: downloadLabel.value ? [downloadLabel.value] : undefined },
            downloader: addDownloader.value,
            save_path: savePath.value,
          }
          let res = await addDownload(payload)
          if (res.requiresConfirmation) {
            if (!(await confirmUnrecognized(title))) return
            res = await addDownload({ ...payload, allow_unrecognized: true })
          }
          if (!res.ok) throw new Error(res.message || '未知错误')
        } catch (error) {
          allOk = false
          const message = error instanceof Error ? error.message : '未知错误'
          ElMessage.error(`添加下载: ${title} 失败: ${message}`)
        }
      }
      if (!allOk) {
        ElMessage.warning('部分下载任务提交失败')
        return
      }
    }
    ElMessage.success('已提交下载任务')
    showAddDownload.value = false
    resetAddForm()
    void fetchList(false)
  } catch (e) {
    console.error(e)
    ElMessage.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    submitting.value = false
  }
}

watch(
  () => activeDownloader.value,
  () => {
    if (activeDownloader.value) {
      void fetchList(true)
      startAutoRefresh()
    }
  },
)

onMounted(async () => {
  await loadDownloaders()
  if (activeDownloader.value) {
    await fetchList(true)
    startAutoRefresh()
  }
  // 消费 pending 路由（PT 悬浮按钮入口）
  try {
    type PendingRoute =
      | string
      | {
          path?: string
          query?: { from?: string; url?: string; title?: string }
        }
    const route = (await storageGet<PendingRoute>(STORAGE_KEYS.PENDING_ROUTE)) as PendingRoute | null
    // 兼容旧写法：仅字符串 'downloads'
    const isDownloads =
      route === 'downloads' ||
      (typeof route === 'object' &&
        route &&
        (route.path === 'downloads' || route.path === '/download'))
    if (isDownloads) {
      downloadType.value = 'site'
      const queryUrl =
        typeof route === 'object' && route?.query?.url ? String(route.query.url) : ''
      if (queryUrl) inputValue.value = queryUrl
      const titleFromRoute =
        typeof route === 'object' && route?.query?.title ? String(route.query.title) : ''
      const titleStored = (await storageGet<string>(STORAGE_KEYS.PT_DOWNLOAD_TITLE)) || ''
      sitePageTitle.value = (titleFromRoute || titleStored).trim()
      showAddDownload.value = true
      addDownloader.value = activeDownloader.value
      void loadDirectories()
      await storageRemove(STORAGE_KEYS.PENDING_ROUTE)
      await storageRemove(STORAGE_KEYS.PT_DOWNLOAD_TITLE)
    }
  } catch {
    /* 待打开路由读取失败时保留下载列表。 */
  }
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<style scoped>
.download-manager {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  /* AppShell .mp-view--flush：操作栏固定，列表内部滚动 */
}

.action-bar {
  display: flex;
  align-items: center;
  padding: 10px 10px 8px;
  border-bottom: 1px solid #e0e0e0;
  background: var(--mp-color-surface, #ffffff);
  gap: 6px;
  --dm-control-height: 28px;
  margin-bottom: 0;
  box-sizing: border-box;
  flex: 0 0 auto;
}

.downloader-select {
  flex: 1;
  min-width: 120px;
}

:deep(.downloader-select .el-select__wrapper) {
  height: var(--dm-control-height) !important;
  min-height: var(--dm-control-height) !important;
  max-height: var(--dm-control-height) !important;
  box-sizing: border-box !important;
  padding: 0 11px !important;
}

.action-buttons {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-buttons .el-button.el-button--small {
  margin: 0 !important;
  height: var(--dm-control-height) !important;
  min-height: var(--dm-control-height) !important;
  max-height: var(--dm-control-height) !important;
  padding: 0 12px !important;
  box-sizing: border-box !important;
  line-height: 1 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.btn-ico {
  margin-right: 4px;
}

/* 首屏加载态在 content 外，flush 下自补外边距 */
.download-loading-state {
  margin: 10px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  box-sizing: border-box;
}

/* 检查态在 download-content 内，由 content 的 padding 留白 */
.download-checking-state {
  margin: 0;
  border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  box-sizing: border-box;
}

.download-loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid rgba(82, 196, 26, 0.16);
  border-top-color: #52c41a;
  animation: download-loading-spin 0.9s linear infinite;
  margin-bottom: 12px;
}

.download-loading-title,
.download-checking-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.download-loading-desc,
.download-checking-desc {
  font-size: 12px;
  color: #6b7280;
}

@keyframes download-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.download-content {
  padding: 10px;
  box-sizing: border-box;
  min-width: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.download-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.download-checking-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  margin-bottom: 10px;
}

.download-checking-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #52c41a;
  animation: download-checking-pulse 1.05s ease-in-out infinite;
}

.download-checking-indicator span:nth-child(2) {
  animation-delay: 0.15s;
}

.download-checking-indicator span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes download-checking-pulse {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.download-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 0 2px;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.no-downloader {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 10px;
  box-sizing: border-box;
}

/* 下载卡片：海报背景和渐变遮罩 */
.dl-card {
  position: relative;
  min-height: 148px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
  background: #1f2937;
  flex-shrink: 0;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.dl-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
}

.dl-card-bg {
  position: absolute;
  inset: 0;
  background-color: #1f2937;
  background-size: cover;
  background-position: top center;
  background-repeat: no-repeat;
  z-index: 0;
}

.dl-card-shade {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image: linear-gradient(
    180deg,
    rgba(31, 41, 55, 0.47) 0%,
    rgb(31, 41, 55) 100%
  );
  border-radius: inherit;
}

.dl-card-body {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 148px;
  padding: 12px 12px 10px;
  color: #fff;
  box-sizing: border-box;
}

.dl-card-top {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 仅标题与状态抢横向空间；描述在下一行占满宽度 */
.dl-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.dl-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  color: #fff;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dl-episode {
  margin-left: 6px;
  font-weight: 600;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

.dl-subtitle {
  width: 100%;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.78);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  overflow-wrap: anywhere;
}

/* 右上角状态：无背景；下载中/已暂停仅色点 */
.dl-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 76px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  padding: 2px 0;
  border: none;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.92);
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dl-status.is-dot-only {
  max-width: none;
  gap: 0;
  padding: 4px 2px;
}

.dl-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.7);
}

.dl-status.is-dot-only .dl-status-dot {
  width: 8px;
  height: 8px;
}

.dl-status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis
}
.dl-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.7);
}

.dl-status--downloading {
  color: #86efac;
}
.dl-status--downloading .dl-status-dot {
  background: #34d399;
  animation: dl-status-pulse 1.4s ease-in-out infinite;
}

.dl-status--paused {
  color: #fcd34d;
}
.dl-status--paused .dl-status-dot {
  background: #fbbf24;
}

.dl-status--error {
  color: #fca5a5;
}
.dl-status--error .dl-status-dot {
  background: #f87171;
}

.dl-status--completed {
  color: #cbd5e1;
}
.dl-status--completed .dl-status-dot {
  background: #94a3b8;
}

@keyframes dl-status-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.85);
  }
}

.dl-meta {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.88);
  word-break: break-all;
}

.dl-progress {
  display: flex;
  flex-direction: column;
}

.dl-progress :deep(.el-progress-bar__outer) {
  background-color: rgba(255, 255, 255, 0.16) !important;
  border-radius: 999px;
}

.dl-progress :deep(.el-progress-bar__inner) {
  border-radius: 999px;
}

/* 底栏操作：播放/暂停 MP primary 紫，删除 error 红 */
.dl-actions {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 4px;
}

.dl-act {
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* 主色 #9155FD */
  color: #9155fd;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition:
    color 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease,
    filter 0.15s ease;
}

.dl-act:hover:not(:disabled) {
  color: #a978ff;
  filter: drop-shadow(0 0 5px rgba(145, 85, 253, 0.45));
}

.dl-act:active:not(:disabled) {
  transform: scale(0.9);
  opacity: 0.9;
}

.dl-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: none;
}

/* 下载中暂停：同样主色紫，略提亮 */
.dl-act.is-pause {
  color: #9155fd;
}

.dl-act.is-pause:hover:not(:disabled) {
  color: #a978ff;
  filter: drop-shadow(0 0 5px rgba(145, 85, 253, 0.5));
}

/* 删除：危险操作色 #FF4C51 */
.dl-act.is-danger {
  color: #ff4c51;
}

.dl-act.is-danger:hover:not(:disabled) {
  color: #ff6b6f;
  filter: drop-shadow(0 0 5px rgba(255, 76, 81, 0.45));
}

.dl-act.is-loading {
  pointer-events: none;
  opacity: 0.5;
  filter: none;
}

/* MDI path 图标：与 MP VBtn icon 同系 */
.dl-act-ico {
  width: 22px;
  height: 22px;
  display: block;
  fill: currentColor;
}

/* 添加下载弹窗 */
:global(.el-overlay:has(.add-download-dialog)) {
  overflow: auto !important;
}

:global(.el-overlay:has(.add-download-dialog) .el-overlay-dialog) {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: center !important;
  overflow: visible !important;
  padding: 24px 0 !important;
  box-sizing: border-box !important;
}

:global(.add-download-dialog.el-dialog) {
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

:global(.add-download-dialog .el-dialog__header) {
  flex: 0 0 auto;
  margin-right: 0;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

:global(.add-download-dialog .el-dialog__title) {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}

:global(.add-download-dialog .el-dialog__headerbtn) {
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
}

:global(.add-download-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 14px 6px;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: none !important;
  height: auto !important;
}

:global(.add-download-dialog .el-dialog__footer) {
  flex: 0 0 auto;
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  background: inherit;
}

.add-dl-form {
  padding-top: 0;
}

.add-dl-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.add-dl-form :deep(.el-form-item:last-child) {
  margin-bottom: 4px;
}

.add-dl-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px !important;
  line-height: 1.25;
  padding: 0;
  height: auto;
}

.add-dl-row-two {
  display: flex;
  gap: 10px;
}

.add-dl-half {
  flex: 1;
  min-width: 0;
  margin-bottom: 12px !important;
}

.add-dl-half :deep(.el-form-item__content),
.add-dl-control {
  width: 100%;
}

/* 小控件统一 30px 高度 */
.add-dl-form :deep(.el-select--small .el-select__wrapper),
.add-dl-form :deep(.el-input--small .el-input__wrapper) {
  height: 30px !important;
  min-height: 30px !important;
  max-height: 30px !important;
  box-sizing: border-box !important;
  border-radius: 8px;
}

.add-dl-form :deep(.el-input__wrapper),
.add-dl-form :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}

.add-dl-form :deep(.el-input__wrapper.is-focus),
.add-dl-form :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #52c41a inset !important;
}

.add-dl-form :deep(.el-textarea__inner) {
  font-size: 12px;
  line-height: 1.45;
  min-height: 72px !important;
  max-height: 120px;
  padding: 8px 10px;
  resize: vertical;
}

/* placeholder 换行生效 */
.add-dl-form :deep(.el-textarea__inner::placeholder) {
  white-space: pre-line;
  font-size: 12px;
  line-height: 1.4;
}

.add-dl-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.add-dl-footer :deep(.el-button) {
  min-width: 72px;
  height: 30px;
  border-radius: 8px;
  font-size: 12px;
  padding: 0 14px;
}

:global(html[data-theme='dark'] .add-download-dialog.el-dialog) {
  background: #1e293b;
  border: 1px solid #334155;
}

:global(html[data-theme='dark'] .add-download-dialog .el-dialog__header),
:global(html[data-theme='dark'] .add-download-dialog .el-dialog__footer) {
  border-color: rgba(148, 163, 184, 0.14);
}

:global(html[data-theme='dark'] .add-download-dialog .el-dialog__title) {
  color: #f1f5f9;
}

:global(html[data-theme='dark']) .add-dl-form :deep(.el-form-item__label) {
  color: #cbd5e1;
}

:global(html[data-theme='dark']) .add-dl-form :deep(.el-input__wrapper),
:global(html[data-theme='dark']) .add-dl-form :deep(.el-textarea__inner),
:global(html[data-theme='dark']) .add-dl-form :deep(.el-select__wrapper) {
  background: #0f172a;
  box-shadow: 0 0 0 1px #334155 inset !important;
  color: #e2e8f0;
}

:global(html[data-theme='dark']) .add-dl-form :deep(.el-input__wrapper.is-focus),
:global(html[data-theme='dark']) .add-dl-form :deep(.el-textarea__inner:focus),
:global(html[data-theme='dark']) .add-dl-form :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #4ade80 inset !important;
}

/* 暗色主题：加载骨架/检查态，!important 压过浅色硬编码 */
:global(html[data-theme='dark']) .action-bar {
  background: var(--mp-color-surface, #1e293b) !important;
  border-bottom-color: #334155 !important;
}
:global(html[data-theme='dark']) .download-loading-state,
:global(html[data-theme='dark']) .download-checking-state {
  background: #1e293b !important;
  border-color: #334155 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) !important;
  color: #e2e8f0 !important;
}
:global(html[data-theme='dark']) .download-loading-title,
:global(html[data-theme='dark']) .download-checking-title {
  color: #e2e8f0 !important;
}
:global(html[data-theme='dark']) .download-loading-desc,
:global(html[data-theme='dark']) .download-checking-desc {
  color: #94a3b8 !important;
}
:global(html[data-theme='dark']) .download-loading-spinner {
  border-color: rgba(74, 222, 128, 0.18) !important;
  border-top-color: #4ade80 !important;
}
:global(html[data-theme='dark']) .download-checking-indicator span {
  background: #4ade80 !important;
}
/* 海报卡本身已是深色底，深色主题仅微调边框/阴影 */
:global(html[data-theme='dark']) .dl-card {
  border-color: #334155 !important;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35) !important;
}
:global(html[data-theme='dark']) .dl-card:hover {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45) !important;
}
:global(html[data-theme='dark']) .empty,
:global(html[data-theme='dark']) .no-downloader {
  color: #94a3b8 !important;
}
</style>
