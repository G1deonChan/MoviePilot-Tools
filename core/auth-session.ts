import { getPrivateStore, updatePrivateStore } from './private-vault'
import type { AuthAccountSecret, AuthSessionSecret, AuthUserProfile } from './storage-contracts'

export interface AuthSessionState {
  accounts: AuthAccountSecret[]
  activeAccountId?: string
  session?: AuthSessionSecret
}

function stripBearer(token: string): string {
  return token.replace(/^Bearer\s+/i, '').trim()
}

export async function getAuthSessionState(): Promise<AuthSessionState> {
  const store = await getPrivateStore()
  return {
    accounts: store.auth?.accounts || [],
    activeAccountId: store.auth?.activeAccountId,
    session: store.auth?.session,
  }
}

export async function getActiveAccountSecret(): Promise<AuthAccountSecret | null> {
  const auth = await getAuthSessionState()
  if (!auth.activeAccountId) return null
  return auth.accounts.find((account) => account.id === auth.activeAccountId) || null
}

export async function getActiveToken(): Promise<string | null> {
  const auth = await getAuthSessionState()
  const session = auth.session
  return session && session.accountId === auth.activeAccountId ? stripBearer(session.token) : null
}

export async function getActiveBaseUrl(): Promise<string | null> {
  return (await getActiveAccountSecret())?.baseURL || null
}

export async function getActiveLoginUsername(): Promise<string | null> {
  return (await getActiveAccountSecret())?.username || null
}

export async function getActiveUserInfo(): Promise<AuthUserProfile | null> {
  const auth = await getAuthSessionState()
  const session = auth.session
  return session && session.accountId === auth.activeAccountId ? session.userInfo : null
}

export async function clearActiveSession(): Promise<void> {
  await updatePrivateStore((draft) => {
    if (draft.auth) delete draft.auth.session
  })
}
