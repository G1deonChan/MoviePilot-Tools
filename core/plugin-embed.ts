const EMBED_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

function getHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.split('?')[1] || '')
}

export function getPluginEmbedParam(urlValue: string, name: string): string | null {
  try {
    const url = new URL(urlValue)
    return url.searchParams.get(name) || getHashParams(url).get(name)
  } catch {
    return null
  }
}

export function getPluginEmbedNonce(urlValue: string): string {
  const nonce = getPluginEmbedParam(urlValue, 'embed_nonce') || ''
  return EMBED_NONCE_PATTERN.test(nonce) ? nonce : ''
}

export function isPluginRouteHash(hash: string): boolean {
  const value = hash.toLowerCase()
  return /#\/plugins(?:[/?]|$)/.test(value) || /#\/plugin(?:[/?]|$)/.test(value)
}

export function isPluginEmbedCandidate(urlValue: string, inIframe: boolean): boolean {
  try {
    const url = new URL(urlValue)
    return (
      inIframe &&
      getPluginEmbedParam(urlValue, 'embed') === '1' &&
      isPluginRouteHash(url.hash) &&
      !!getPluginEmbedNonce(urlValue)
    )
  } catch {
    return false
  }
}

