// Offscreen Document 生命周期（离线 OCR 需要 DOM + WASM）
// Offscreen 文档负责执行本地 OCR 推理。

/** WXT 将 entrypoints/offscreen 构建为产物根目录 offscreen.html */
const OFFSCREEN_URL = '/offscreen.html'

let creating: Promise<void> | null = null

/** 确保 Offscreen 文档已创建（可重复调用） */
export async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('当前浏览器不支持 Offscreen Document，无法使用离线 OCR')
  }

  try {
    const existing = await chrome.offscreen.hasDocument?.()
    if (existing) return
  } catch {
    /* 部分实现无 hasDocument，继续尝试创建 */
  }

  if (creating) {
    await creating
    return
  }

  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_SCRAPING' as chrome.offscreen.Reason],
      justification: '离线 OCR 推理需要 DOM 环境加载 ONNX Runtime WASM',
    })
    .then(() => undefined)
    .catch(async (err: unknown) => {
      // 并发创建时可能已存在
      const msg = String(err ?? '')
      if (/already|exist/i.test(msg)) return
      try {
        if (await chrome.offscreen.hasDocument?.()) return
      } catch {
        /* 无法复查文档状态时保留原创建错误。 */
      }
      throw err instanceof Error ? err : new Error(msg || '创建 Offscreen 失败')
    })
    .finally(() => {
      creating = null
    })

  await creating
}
