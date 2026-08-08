import { api, registerTokenRefreshHandler } from '../core/http'
import {
  clearActiveSession,
  getActiveBaseUrl,
  getActiveLoginUsername,
  getActiveToken,
  getActiveUserInfo,
} from '../core/auth-session'
import { getPrivateStore, updatePrivateStore } from '../core/private-vault'
import type { AuthAccountSecret, AuthSessionSecret, AuthUserProfile } from '../core/storage-contracts'
import { maskBaseUrl, normalizeBaseUrl } from '../utils/url'

export interface LoginResult {
  success: boolean
  message?: string
}

export type MpUserInfo = AuthUserProfile

export interface StoredLoginCredentials {
  baseURL: string
  username: string
  password: string
  otp_password?: string
  serverName?: string
}

export interface MpAccount {
  id: string
  label: string
  baseURL: string
  serverName?: string
  username: string
  password: string
  otp_password?: string
  token?: string
  userInfo?: MpUserInfo
  lastLoginAt?: number
  createdAt: number
}

export interface MpAccountPublic {
  id: string
  label: string
  baseURL: string
  serverName?: string
  username: string
  userName: string
  avatar: string
  superUser: boolean
  hasToken: boolean
  lastLoginAt?: number
  isActive: boolean
}

interface LoginResponse {
  access_token?: string
  token_type?: string
  super_user?: boolean
  user_id?: number
  user_name?: string
  avatar?: string
  level?: number
  permissions?: Record<string, boolean>
  wizard?: boolean
}

const refreshLocks = new Map<string, Promise<string | null>>()

function stripBearer(token: string): string {
  return token.replace(/^Bearer\s+/i, '').trim()
}

function newAccountId(): string {
  return crypto.randomUUID()
}

function accountKey(baseURL: string, username: string): string {
  const base = (normalizeBaseUrl(baseURL) || baseURL || '').replace(/\/+$/, '').toLowerCase()
  return `${base}::${username.trim().toLowerCase()}`
}

function makeLabel(baseURL: string, username: string, userName?: string): string {
  const host = maskBaseUrl(baseURL).replace(/^https?:\/\//i, '') || '***'
  return `${(userName || username || '').trim() || 'user'}@${host}`
}

function toUserInfo(data: LoginResponse): MpUserInfo {
  return {
    superUser: !!data.super_user,
    userID: data.user_id ?? -1,
    userName: data.user_name ?? '',
    avatar: data.avatar ?? '',
    level: data.level ?? 2,
    permissions: data.permissions ?? {},
    wizard: !!data.wizard,
  }
}

function toAccount(
  secret: AuthAccountSecret,
  session: AuthSessionSecret | undefined,
): MpAccount {
  const activeSession = session?.accountId === secret.id ? session : undefined
  return {
    id: secret.id,
    label: secret.label,
    baseURL: secret.baseURL,
    serverName: secret.serverName,
    username: secret.username,
    password: secret.password,
    otp_password: secret.otpPassword,
    token: activeSession?.token,
    userInfo: activeSession?.userInfo || secret.userInfo,
    lastLoginAt: secret.lastLoginAt,
    createdAt: secret.createdAt,
  }
}

async function readAuth(): Promise<{
  accounts: AuthAccountSecret[]
  activeAccountId?: string
  session?: AuthSessionSecret
}> {
  const store = await getPrivateStore()
  return {
    accounts: store.auth?.accounts || [],
    activeAccountId: store.auth?.activeAccountId,
    session: store.auth?.session,
  }
}

async function requestAccessToken(opts: {
  baseURL: string
  username: string
  password: string
  otp_password?: string
}): Promise<{ ok: true; data: LoginResponse } | { ok: false; message: string; mfaRequired?: boolean }> {
  const base = normalizeBaseUrl(opts.baseURL)
  if (!base) return { ok: false, message: '服务器地址无效' }
  const form = new URLSearchParams()
  form.set('username', opts.username)
  form.set('password', opts.password)
  if (opts.otp_password) form.set('otp_password', opts.otp_password)
  try {
    const res = await fetch(`${base}/api/v1/login/access-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    if (!res.ok) {
      const mfa = (res.headers.get('X-MFA-Required') || '').toLowerCase() === 'true'
      let detail = `登录失败 (HTTP ${res.status})`
      try {
        const body = (await res.json()) as { detail?: string }
        if (body?.detail) detail = String(body.detail)
      } catch {
        // 响应不是 JSON 时保留 HTTP 错误
      }
      return { ok: false, message: detail, mfaRequired: mfa || /双重|验证码|mfa|otp/i.test(detail) }
    }
    const data = (await res.json()) as LoginResponse
    if (!data.access_token) return { ok: false, message: '未返回访问令牌' }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

async function upsertAccountFromLogin(opts: {
  baseURL: string
  username: string
  password: string
  otp_password?: string
  serverName?: string
  data: LoginResponse
}): Promise<MpAccount> {
  const baseURL = normalizeBaseUrl(opts.baseURL) || opts.baseURL
  const userInfo = toUserInfo(opts.data)
  const token = stripBearer(opts.data.access_token || '')
  const now = Date.now()
  let saved!: AuthAccountSecret
  await updatePrivateStore((draft) => {
    const auth = draft.auth || { accounts: [] }
    const index = auth.accounts.findIndex(
      (account) => accountKey(account.baseURL, account.username) === accountKey(baseURL, opts.username),
    )
    const previous = index >= 0 ? auth.accounts[index] : undefined
    saved = {
      id: previous?.id || newAccountId(),
      label: makeLabel(baseURL, opts.username, userInfo.userName),
      baseURL,
      serverName: opts.serverName || previous?.serverName,
      username: opts.username,
      password: opts.password,
      otpPassword: opts.otp_password || previous?.otpPassword,
      userInfo,
      createdAt: previous?.createdAt || now,
      lastLoginAt: now,
    }
    if (index >= 0) auth.accounts[index] = saved
    else auth.accounts.unshift(saved)
    auth.activeAccountId = saved.id
    auth.session = { accountId: saved.id, token, userInfo, updatedAt: now }
    draft.auth = auth
  })
  return toAccount(saved, { accountId: saved.id, token, userInfo, updatedAt: now })
}

export async function listAccounts(): Promise<MpAccountPublic[]> {
  const auth = await readAuth()
  return auth.accounts
    .slice()
    .sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0))
    .map((account) => {
      const session = auth.session?.accountId === account.id ? auth.session : undefined
      const userInfo = session?.userInfo || account.userInfo
  return {
    id: account.id,
    label: makeLabel(account.baseURL, account.username, userInfo?.userName),
    baseURL: maskBaseUrl(account.baseURL),
    serverName: account.serverName,
    username: account.username,
    userName: userInfo?.userName || account.username,
    avatar: userInfo?.avatar || '',
    superUser: !!userInfo?.superUser,
    hasToken: !!session?.token,
    lastLoginAt: account.lastLoginAt,
    isActive: account.id === auth.activeAccountId,
  }
    })
}

export async function getActiveAccount(): Promise<MpAccount | null> {
  const auth = await readAuth()
  if (!auth.activeAccountId) return null
  const account = auth.accounts.find((item) => item.id === auth.activeAccountId)
  return account ? toAccount(account, auth.session) : null
}

export async function saveLoginCredentials(creds: StoredLoginCredentials): Promise<void> {
  const baseURL = normalizeBaseUrl(creds.baseURL) || creds.baseURL
  await updatePrivateStore((draft) => {
    const auth = draft.auth || { accounts: [] }
    const index = auth.accounts.findIndex(
      (account) => accountKey(account.baseURL, account.username) === accountKey(baseURL, creds.username),
    )
    const previous = index >= 0 ? auth.accounts[index] : undefined
    const account: AuthAccountSecret = {
      id: previous?.id || newAccountId(),
      label: previous?.label || makeLabel(baseURL, creds.username),
      baseURL,
      serverName: creds.serverName || previous?.serverName,
      username: creds.username,
      password: creds.password,
      otpPassword: creds.otp_password,
      userInfo: previous?.userInfo,
      createdAt: previous?.createdAt || Date.now(),
      lastLoginAt: previous?.lastLoginAt,
    }
    if (index >= 0) auth.accounts[index] = account
    else auth.accounts.unshift(account)
    auth.activeAccountId = account.id
    draft.auth = auth
  })
}

export async function loadLoginCredentials(): Promise<StoredLoginCredentials | null> {
  const account = await getActiveAccount()
  return account
    ? {
        baseURL: account.baseURL,
        username: account.username,
        password: account.password,
        otp_password: account.otp_password,
        serverName: account.serverName,
      }
    : null
}

export async function clearLoginCredentials(): Promise<void> {
  await updatePrivateStore((draft) => {
    if (!draft.auth?.activeAccountId) return
    draft.auth.accounts = draft.auth.accounts.filter(
      (account) => account.id !== draft.auth!.activeAccountId,
    )
    delete draft.auth.activeAccountId
    delete draft.auth.session
  })
}

export async function login(
  baseUrl: string,
  username: string,
  password: string,
  otp?: string,
  serverName?: string,
): Promise<LoginResult> {
  const baseURL = normalizeBaseUrl(baseUrl)
  if (!baseURL) return { success: false, message: '服务器地址无效' }
  const result = await requestAccessToken({ baseURL, username, password, otp_password: otp })
  if (!result.ok) return { success: false, message: result.message }
  await upsertAccountFromLogin({
    baseURL,
    username,
    password,
    otp_password: otp,
    serverName,
    data: result.data,
  })
  return { success: true }
}

export async function switchAccount(accountId: string): Promise<LoginResult> {
  const auth = await readAuth()
  const account = auth.accounts.find((item) => item.id === accountId)
  if (!account) return { success: false, message: '账号不存在' }
  if (auth.session?.accountId === account.id && auth.session.token) {
    await updatePrivateStore((draft) => {
      if (draft.auth) draft.auth.activeAccountId = account.id
    })
    if (await ping()) return { success: true }
  }
  const result = await requestAccessToken({
    baseURL: account.baseURL,
    username: account.username,
    password: account.password,
    otp_password: account.otpPassword,
  })
  if (!result.ok) return { success: false, message: result.message }
  await upsertAccountFromLogin({
    baseURL: account.baseURL,
    username: account.username,
    password: account.password,
    otp_password: account.otpPassword,
    data: result.data,
  })
  return { success: true }
}

export async function removeAccount(accountId: string): Promise<void> {
  await updatePrivateStore((draft) => {
    if (!draft.auth) return
    draft.auth.accounts = draft.auth.accounts.filter((account) => account.id !== accountId)
    if (draft.auth.activeAccountId === accountId) delete draft.auth.activeAccountId
    if (draft.auth.session?.accountId === accountId) delete draft.auth.session
  })
}

export async function refreshTokenSilently(): Promise<string | null> {
  const account = await getActiveAccount()
  if (!account?.password) return null
  const existing = refreshLocks.get(account.id)
  if (existing) return existing
  const task = (async () => {
    try {
      const result = await requestAccessToken({
        baseURL: account.baseURL,
        username: account.username,
        password: account.password,
        otp_password: account.otp_password,
      })
      if (!result.ok) return null
      const updated = await upsertAccountFromLogin({
        baseURL: account.baseURL,
        username: account.username,
        password: account.password,
        otp_password: account.otp_password,
        data: result.data,
      })
      return updated.token || null
    } finally {
      refreshLocks.delete(account.id)
    }
  })()
  refreshLocks.set(account.id, task)
  return task
}

export async function clearActiveSessionToken(): Promise<void> {
  await clearActiveSession()
}

export async function logout(): Promise<void> {
  await updatePrivateStore((draft) => {
    if (!draft.auth) return
    delete draft.auth.activeAccountId
    delete draft.auth.session
  })
}

export async function logoutAll(removeAccounts = false): Promise<void> {
  await updatePrivateStore((draft) => {
    if (!draft.auth) return
    if (removeAccounts) delete draft.auth
    else {
      delete draft.auth.activeAccountId
      delete draft.auth.session
    }
  })
}

export async function getToken(): Promise<string | null> {
  return getActiveToken()
}

export async function getBaseUrl(): Promise<string | null> {
  return getActiveBaseUrl()
}

export async function getLoginUsername(): Promise<string | null> {
  return getActiveLoginUsername()
}

export async function getUserInfo(): Promise<MpUserInfo | null> {
  return getActiveUserInfo()
}

registerTokenRefreshHandler(refreshTokenSilently)

export async function isLoggedIn(): Promise<boolean> {
  return !!(await getToken())
}

export async function ping(): Promise<boolean> {
  return (await api.get('/api/v1/system/env')).ok
}
