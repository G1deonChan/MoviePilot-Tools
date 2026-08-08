export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id
  } catch {
    return false
  }
}

export function isExtensionContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /extension context invalidated|receiving end does not exist|message port closed|context invalidated/i.test(
    message,
  )
}

export function addRuntimeMessageListener(
  listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
): boolean {
  if (!isExtensionContextValid()) return false
  try {
    chrome.runtime.onMessage.addListener(listener)
    return true
  } catch {
    return false
  }
}
