// 全局类型定义（对应 MoviePilot 后端实体）

// 站点筛选/状态标记（运行态，不持久化；多标签可并存，非互斥状态机）
export interface SiteStatus {
  browser: boolean
  server: boolean
  cookieDiff: boolean
  uaDiff: boolean
  notLoggedIn: boolean
  notAdded: boolean
  /** 以已适配 S 为基座、已配置 C 中未出现（S−C），不是「两边均未出现」 */
  notOwned: boolean
}

/** 统一站点行（已配置 / 虚拟未拥有或未添加） */
export type SiteRowKind = 'configured' | 'virtual'

export interface SiteSupportingInfo {
  id?: number | string
  name?: string
  domain: string
  url?: string
  public?: boolean
}

export interface SiteDomainAlias {
  siteId: string
  domain: string
  createdAt?: string
}

export interface BrowserSessionInfo {
  cookieHeader: string
  names: string[]
  hasAuthSession: boolean
  hasTrace: boolean
}

export interface SiteRow {
  key: string
  kind: SiteRowKind
  supported: boolean
  supporting?: SiteSupportingInfo
  site?: Site
  browserCookie?: string
  browserUA?: string
  hasAuthSession: boolean
  hasTrace: boolean
  flags: SiteStatus
}

export interface Site {
  id: number
  name: string
  domain: string
  url?: string
  icon?: string
  pri?: number
  timeout?: number
  downloader?: string
  cookie?: string
  ua?: string
  rss?: string
  apikey?: string
  token?: string
  /** 是否公开站点（MoviePilot API 为 0/1） */
  public?: number | boolean
  is_active?: boolean
  is_limited?: boolean
  is_proxy?: boolean
  is_browser_simulated?: boolean
  lst_state?: 'normal' | 'slow' | 'failed' | 'unknown'
  seconds?: number
  // 限流参数
  limit_interval?: number
  limit_count?: number
  limit_seconds?: number
  // 前端运行态，不写入服务器
  browserCookies?: string
  cookieDiff?: boolean
  uaDiff?: boolean
  isDisabled?: boolean
  isUpdateDisabled?: boolean
  status?: SiteStatus
}

export interface SiteUserData {
  domain: string
  username?: string
  user_level?: string
  join_at?: string
  upload?: number
  download?: number
  ratio?: number
  seeding?: number
  seeding_size?: number
  bonus?: number
  site?: string
  name?: string
}

/** 站点连接统计（/api/v1/site/statistic 数组项） */
export interface SiteConnectionStat {
  domain: string
  seconds?: number
  succ_rate?: number
  /** 0 正常，1 失败 */
  lst_state?: number
}



export interface DownloadClient {
  id?: string
  name: string
  type?: string
  enabled?: boolean
}

/** `/api/v1/download/` 返回的正在下载任务。 */
export interface DownloadTask {
  hash: string
  name: string
  title?: string
  state?: 'downloading' | 'paused' | 'completed' | 'error' | string
  progress?: number
  size?: number
  /** 接口可能返回已格式化字符串或数字 */
  dlspeed?: number | string
  upspeed?: number | string
  left_time?: string
  eta?: number
  save_path?: string
  season_episode?: string
  media?: {
    title?: string
    episode?: string
    season?: string
    image?: string
  }
}

export interface DownloadDirectory {
  name: string
  download_path: string
  save_path?: string
  storage?: string
  priority?: number
}

export interface AddTorrentIn {
  title: string
  description?: string
  enclosure: string
  page_url?: string
  site?: number
  site_name?: string
  site_cookie?: string
  site_ua?: string
  site_proxy?: boolean
  site_order?: number
  site_downloader?: string
  size?: number
  seeders?: number
  peers?: number
  grabs?: number
  category?: string
  volume_factor?: string
  upload_volume_factor?: number
  download_volume_factor?: number
  labels?: string[]
  pri_order?: number
}

export interface AddDownloadRequest {
  torrent_in: AddTorrentIn
  media_in?: Record<string, unknown>
  downloader?: string
  save_path?: string
  tmdbid?: number
  doubanid?: string
  media_source?: string
  media_id?: string
  music_type?: 'recording' | 'album'
  allow_unrecognized?: boolean
  label?: string
}

/** MoviePilot 用户功能权限。 */
export interface UserPermissions {
  discovery?: boolean
  search?: boolean
  subscribe?: boolean
  manage?: boolean
  admin?: boolean
  features?: Record<string, boolean>
}

export interface UserInfo {
  id?: number
  name: string
  avatar?: string
  is_superuser?: boolean
  is_active?: boolean
  email?: string
  roles?: string[]
  /** 普通用户功能权限；超管默认全开 */
  permissions?: UserPermissions | Record<string, unknown>
}

export interface TotpSite {
  id: string
  name: string
  /** 用于域名匹配自动填充 */
  domain?: string
  secret: string
  /** 导入数据仅含 `group` 时读取该字段；同时存在时优先 `category`，在仍支持该导入格式期间保留。 */
  group?: string
  /** 打开站点用完整 URL */
  url?: string
  /** 分组：PT站点 / 自定义 */
  category?: 'pt' | 'custom'
  icon?: string
  createdAt?: string
  updatedAt?: string
}

export type CredentialCategory = 'pt' | 'intranet' | 'custom'

export interface CredentialGroup {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export interface PtCredential {
  id?: string
  domain: string
  username: string
  password: string
  name?: string
  category?: CredentialCategory
  groupId?: string
  createdAt?: string
  updatedAt?: string
  autoSaveEnabled?: boolean
  autoFillEnabled?: boolean
}

/** 站点黑名单条目（凭据/填充拦截） */
export interface SiteBlacklistEntry {
  id: string
  domain: string
  name?: string
  blockLoginFill?: boolean
  blockCaptchaFill?: boolean
  blockCredentialSavePrompt?: boolean
  createdAt?: string
  updatedAt?: string
}
