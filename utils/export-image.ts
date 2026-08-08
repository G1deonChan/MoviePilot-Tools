// 将页面 DOM 渲染并导出为 PNG 图片。
// 隐私：emoji 覆盖；站点多时导出自动多列（最多 5 列）缩短高度
import html2canvas from 'html2canvas'
import { downloadDataUrl } from './file'

export type ExportColumns = 1 | 2 | 3 | 4 | 5 | 'auto'

export interface ExportImageOptions {
  filename?: string
  quality?: number
  privacyMode?: boolean
  blurSensitiveData?: boolean
  title?: string
  footerSuffix?: string
  /** 强制列数 1–5；默认按站点数量自动，最多 5 列 */
  columns?: ExportColumns
}

/**
 * 将 DOM 元素导出为 PNG 并触发下载。
 * - 离屏克隆，隐藏工具栏/按钮
 * - 隐私模式：敏感文本/图标 emoji 脱敏
 * - 站点卡片按数量自动多列（最多 5 列）缩短长图
 * - 页眉 / 页脚水印
 */
export async function exportElementAsImage(
  element: HTMLElement,
  options: ExportImageOptions = {},
): Promise<void> {
  const {
    filename = getDefaultImageFilename('data'),
    quality = 0.9,
    privacyMode = false,
    blurSensitiveData = true,
    title = 'MoviePilot 站点数据',
    footerSuffix = '导出自 MoviePilot Tools',
    columns = 'auto',
  } = options

  // 以扩展内卡片实际宽度为「单列宽」，多列 = 单列宽 × 列数（不压缩列表内容）
  const firstCard = element.querySelector('.site-card') as HTMLElement | null
  const unitWidth = Math.max(
    280,
    Math.round(
      firstCard?.getBoundingClientRect().width ||
        element.clientWidth ||
        element.getBoundingClientRect().width ||
        360,
    ),
  )

  const cloned = element.cloneNode(true) as HTMLElement
  cloned.style.padding = '10px'
  cloned.style.background = '#f5f7fa'
  cloned.style.boxSizing = 'border-box'
  cloned.style.position = 'absolute'
  cloned.style.left = '-9999px'
  cloned.style.top = '0'
  cloned.style.zIndex = '-1'
  cloned.style.opacity = '1'
  cloned.style.transform = 'none'
  cloned.classList.add('export-hide')

  // 多列布局：宽度按扩展宽度相加，卡片保持原尺寸
  const layout = resolveExportLayout(cloned, columns, unitWidth)
  cloned.style.width = layout.width + 'px'
  cloned.style.minWidth = layout.width + 'px'
  cloned.style.maxWidth = layout.width + 'px'
  cloned.classList.add(layout.className)
  // CSS 变量：单列内容宽 / 列间距，供 grid 使用
  cloned.style.setProperty('--export-col-w', layout.colWidth + 'px')
  cloned.style.setProperty('--export-gap', layout.gap + 'px')

  if (privacyMode && blurSensitiveData) {
    processSensitiveData(cloned)
  }
  addHeaderAndFooter(cloned, title, footerSuffix)

  document.body.appendChild(cloned)
  try {
    await new Promise((r) => setTimeout(r, 120))
    cloned.style.height = 'auto'
    cloned.style.minHeight = 'auto'
    cloned.style.maxHeight = 'none'

    const canvas = await html2canvas(cloned, {
      backgroundColor: '#ffffff',
      scale: 1.15,
      useCORS: true,
      allowTaint: true,
      logging: false,
      removeContainer: true,
      foreignObjectRendering: false,
      imageTimeout: 0,
      scrollX: 0,
      scrollY: 0,
      width: layout.width,
      windowWidth: layout.width,
      onclone: (clonedDoc) => {
        const body = clonedDoc.body
        if (!body) return
        body.querySelectorAll('script').forEach((s) => s.remove())
        const style = clonedDoc.createElement('style')
        style.textContent = buildExportCss()
        body.appendChild(style)
      },
      ignoreElements: (el) => (el as HTMLElement).style?.display === 'none',
    })

    const dataURL = canvas.toDataURL('image/png', Math.min(quality, 1))
    downloadDataUrl(dataURL, filename)
  } catch (e) {
    console.error('[export-image]', e)
    throw new Error('导出图片失败，请重试')
  } finally {
    if (document.body.contains(cloned)) document.body.removeChild(cloned)
  }
}

/**
 * 多列宽度 = 扩展内容宽度 × 列数 + 列间距。
 * 导出时保持页面单列内容宽度，不压缩卡片内部布局。
 */
function resolveExportLayout(
  root: HTMLElement,
  columns: ExportColumns,
  unitWidth: number,
): { cols: number; width: number; colWidth: number; gap: number; className: string } {
  const cardCount = root.querySelectorAll('.site-cards > .site-card').length
  let cols: number
  if (columns === 'auto') {
    // 约每列 4 张卡片；最多 5 列
    if (cardCount >= 20) cols = 5
    else if (cardCount >= 15) cols = 4
    else if (cardCount >= 10) cols = 3
    else if (cardCount >= 5) cols = 2
    else cols = 1
  } else {
    cols = Math.min(5, Math.max(1, columns))
  }

  const gap = 10
  // 根节点左右 padding 10*2
  const rootPadX = 20
  // 每列内容宽 = 扩展内卡片原宽
  const colWidth = unitWidth
  // 总宽 = 列宽*列数 + 间距*(列数-1) + 根 padding
  const width = colWidth * cols + gap * Math.max(0, cols - 1) + rootPadX
  return { cols, width, colWidth, gap, className: 'export-cols-' + cols }
}

function buildExportCss(): string {
  return `
    * { box-sizing: border-box !important; }
    body {
      margin: 0 !important;
      padding: 0 !important;
      height: auto !important;
      min-height: auto !important;
      background: #fff !important;
    }
    .export-hide {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      max-width: none !important;
    }
    .export-hide .toolbar,
    .export-hide .toolbar-row,
    .export-hide .card-actions,
    .export-hide .action-btn,
    .export-hide .el-input,
    .export-hide .el-select,
    .export-hide .el-button,
    .export-hide .el-dropdown,
    .export-hide .el-dropdown-menu,
    .export-hide .el-tooltip,
    .export-hide .icon-btn,
    .export-hide .icon-prefix,
    .export-hide .compact,
    .export-hide .el-card__footer,
    .export-hide .expand-icon,
    .export-hide .el-button--text,
    .export-hide .setting-btns {
      display: none !important;
    }

    /* 多列：每列固定为扩展内容宽，不把卡片挤窄 */
    .export-hide .site-cards {
      display: grid !important;
      gap: var(--export-gap, 10px) !important;
      padding: 0 !important;
      margin: 0 !important;
      width: 100% !important;
      max-width: none !important;
    }
    .export-hide.export-cols-1 .site-cards {
      grid-template-columns: var(--export-col-w, 100%) !important;
    }
    .export-hide.export-cols-2 .site-cards {
      grid-template-columns: repeat(2, var(--export-col-w, 1fr)) !important;
    }
    .export-hide.export-cols-4 .site-cards {
      grid-template-columns: repeat(4, var(--export-col-w, 1fr)) !important;
    }
    .export-hide.export-cols-5 .site-cards {
      grid-template-columns: repeat(5, var(--export-col-w, 1fr)) !important;
    }
    .export-hide.export-cols-3 .site-cards {
      grid-template-columns: repeat(3, var(--export-col-w, 1fr)) !important;
    }

    /* 卡片保持扩展内原始尺寸与排版，不压缩字号/指标 */
    .export-hide .site-card {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      box-shadow: none !important;
      transform: none !important;
      width: 100% !important;
      max-width: var(--export-col-w, 100%) !important;
      min-width: 0 !important;
    }
    .export-hide .site-card:hover {
      transform: none !important;
      box-shadow: none !important;
    }
    .export-hide .metrics-grid {
      grid-template-columns: repeat(4, 1fr) !important;
    }
    /* 总览条：随画布拉宽，不跟列宽走 */
    .export-hide .overview {
      width: 100% !important;
      max-width: none !important;
    }
    .export-hide .grid {
      width: 100% !important;
      max-width: none !important;
    }
  `
}

/** 隐私模式使用 emoji 覆盖敏感文本和图标。 */
function processSensitiveData(element: HTMLElement): void {
  const style = document.createElement('style')
  style.textContent = `
    .privacy-mask .username,
    .privacy-mask .user-level,
    .privacy-mask .site-name,
    .privacy-mask .privacy-blur {
      background-color: rgba(0, 0, 0, 0.1) !important;
      color: #999 !important;
      border-radius: 4px !important;
      padding: 2px 6px !important;
      font-family: monospace !important;
      letter-spacing: 1px !important;
      filter: none !important;
    }
    .privacy-mask .site-logo,
    .privacy-mask .el-avatar,
    .privacy-mask img {
      background-color: rgba(0, 0, 0, 0.2) !important;
      color: #666 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-height: 32px !important;
      min-width: 32px !important;
      filter: none !important;
    }
  `
  element.appendChild(style)
  element.classList.add('privacy-mask')

  for (const selector of ['.username', '.user-level', '.site-name', '.privacy-blur']) {
    element.querySelectorAll(selector).forEach((el) => {
      const htmlEl = el as HTMLElement
      // 跳过 logo 容器，避免把图标区文字也刷成 emoji 串
      if (htmlEl.classList.contains('site-logo') || htmlEl.closest('.site-logo')) return
      if ((htmlEl.textContent || '').trim()) htmlEl.textContent = '😜😜😜😜'
    })
  }

  element.querySelectorAll('.site-logo, .el-avatar').forEach((el) => {
    ;(el as HTMLElement).innerHTML = '<span style="font-size: 28px; line-height: 1;">😁</span>'
  })
  // 独立 img（不在已处理容器内）
  element.querySelectorAll('img').forEach((el) => {
    const parent = el.parentElement
    if (parent && (parent.classList.contains('site-logo') || parent.classList.contains('el-avatar'))) {
      return
    }
    const wrap = document.createElement('span')
    wrap.textContent = '😁'
    wrap.style.fontSize = '28px'
    el.replaceWith(wrap)
  })
}

function addHeaderAndFooter(element: HTMLElement, title: string, footerSuffix: string): void {
  const style = document.createElement('style')
  style.textContent = `
    .export-header {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      margin-bottom: 12px;
      color: #333;
    }
    .export-footer {
      text-align: right;
      font-size: 13px;
      color: #888;
      margin-top: 16px;
      margin-bottom: 8px;
    }
  `
  element.appendChild(style)

  const header = document.createElement('div')
  header.className = 'export-header'
  header.textContent = title
  element.insertBefore(header, element.firstChild)

  const footer = document.createElement('div')
  footer.className = 'export-footer'
  const now = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  footer.textContent = now + ' ' + footerSuffix
  element.appendChild(footer)
}

export function getDefaultImageFilename(type: 'dashboard' | 'sites' | 'data' = 'data'): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  return 'mp-' + type + '-' + timestamp + '.png'
}