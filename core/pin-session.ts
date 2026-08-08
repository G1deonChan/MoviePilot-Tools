import { storage } from 'wxt/storage'

const SESSION_UNLOCK_KEY = 'session:mpt2.pin-unlocked' as const

export async function markPinSessionUnlocked(): Promise<void> {
  await storage.setItem(SESSION_UNLOCK_KEY, true)
}

export async function isPinSessionUnlocked(): Promise<boolean> {
  return (await storage.getItem<boolean>(SESSION_UNLOCK_KEY)) === true
}

export async function clearPinSessionUnlocked(): Promise<void> {
  await storage.removeItem(SESSION_UNLOCK_KEY)
}
