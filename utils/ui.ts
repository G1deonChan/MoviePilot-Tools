// Element Plus 反馈组件从主入口导入，依赖应用级完整注册。
// 从主入口 'element-plus' 导入（其 CSS 已由 main.ts 的 element-plus/dist/index.css 全量引入）。
// 不再使用 on-demand 时代的 element-plus/es/components/** 深度子路径，避免压缩构建下的不确定性。
import { ElMessage, ElMessageBox, type ElMessageBoxOptions } from 'element-plus'

export { ElMessage, ElMessageBox }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

export async function promptPassword(
  message: string,
  title = '输入密钥',
  accent: 'credentials' | 'totp' = 'credentials',
): Promise<string> {
  const content = `
    <div class="mp-legacy-import__intro">
      <span class="mp-legacy-import__badge">旧版加密备份</span>
      <p>${escapeHtml(message)}</p>
    </div>
    <div class="mp-legacy-import__notice">
      <span class="mp-legacy-import__notice-icon" aria-hidden="true">i</span>
      <span>密钥仅用于本次解密，不会保存或转换为 2.0 恢复密钥。</span>
    </div>
  `
  const result = await ElMessageBox.prompt(content, title, {
    customClass: `mp-message-box mp-message-box--legacy-import mp-message-box--legacy-${accent}`,
    confirmButtonText: '解密并导入',
    cancelButtonText: '取消',
    inputType: 'password',
    inputPlaceholder: '输入旧版备份密钥',
    inputValidator: (value) => Boolean(value?.trim()) || '请输入旧版备份密钥',
    dangerouslyUseHTMLString: true,
    autofocus: false,
    closeOnClickModal: false,
    lockScroll: false,
  })
  return result.value.trim()
}

type ConfirmKind = 'danger' | 'warning' | 'info'

export interface ConfirmOptions {
  title?: string
  /** danger=删除类（红按钮）；warning/info 默认主色确认钮 */
  kind?: ConfirmKind
  confirmButtonText?: string
  cancelButtonText?: string
  type?: ElMessageBoxOptions['type']
  dangerouslyUseHTMLString?: boolean
  distinguishCancelAndClose?: boolean
}

/**
 * 统一确认弹窗（删除/警告）：应用 mp-message-box 紧凑样式。
 * 用户取消/关闭会 reject，调用处用 try/catch 即可。
 */
export function confirmAction(
  message: string,
  options: ConfirmOptions = {},
): Promise<void> {
  const kind = options.kind || 'warning'
  const isDanger = kind === 'danger'
  const customClass = [
    'mp-message-box',
    isDanger ? 'mp-message-box--danger' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return ElMessageBox.confirm(message, options.title || '确认', {
    type: options.type || (isDanger ? 'warning' : kind === 'info' ? 'info' : 'warning'),
    confirmButtonText: options.confirmButtonText || (isDanger ? '删除' : '确定'),
    cancelButtonText: options.cancelButtonText || '取消',
    customClass,
    autofocus: false,
    closeOnClickModal: false,
    // popup 固定尺寸且 body 不滚动；关 lock 避免 body 被减滚动条宽导致整页左缩
    lockScroll: false,
    distinguishCancelAndClose: options.distinguishCancelAndClose,
    dangerouslyUseHTMLString: options.dangerouslyUseHTMLString,
  }).then(() => undefined)
}

/** 删除类确认（红按钮 + 默认标题「删除确认」） */
export function confirmDelete(
  message: string,
  options: Omit<ConfirmOptions, 'kind'> = {},
): Promise<void> {
  return confirmAction(message, {
    title: '删除确认',
    kind: 'danger',
    confirmButtonText: '删除',
    ...options,
  })
}

/** 文本输入弹窗（新建/重命名分组等），统一紧凑样式 */
export async function promptText(
  title: string,
  message: string,
  options?: {
    inputValue?: string
    inputPlaceholder?: string
    confirmButtonText?: string
    cancelButtonText?: string
    inputValidator?: (value: string) => true | string
  },
): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(message, title, {
      customClass: 'mp-message-box mp-message-box--prompt',
      confirmButtonText: options?.confirmButtonText ?? '确定',
      cancelButtonText: options?.cancelButtonText ?? '取消',
      inputValue: options?.inputValue ?? '',
      inputPlaceholder: options?.inputPlaceholder ?? '',
      inputValidator: options?.inputValidator,
      autofocus: false,
      closeOnClickModal: false,
      lockScroll: false,
    })
    return String(result.value ?? '').trim()
  } catch {
    return null
  }
}
