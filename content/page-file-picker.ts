import {
  PAGE_FILE_PICKER_CANCEL,
  PAGE_FILE_PICKER_OPEN,
  pageFilePickerPortName,
  type PageFilePickerOpenMessage,
} from '../core/page-file-picker-contracts'
import { addRuntimeMessageListener } from '../core/extension-context'
import { encodePageFileChunk, PAGE_FILE_CHUNK_BYTES } from '../core/page-file-chunks'
const HOST_ID = 'mp-page-file-picker'

/** 在普通网页中显示可见原生文件控件，解决移动端扩展页无法打开系统文件管理器。 */
export function initPageFilePicker(): void {
  addRuntimeMessageListener((message: PageFilePickerOpenMessage) => {
    if (message?.type !== PAGE_FILE_PICKER_OPEN || !message.requestId) return false
    showPicker(message.requestId, message.options || {})
    return false
  })
}

function showPicker(
  requestId: string,
  options: { action?: string; view?: string; accept?: string; multiple?: boolean; title?: string },
): void {
  document.getElementById(HOST_ID)?.remove()

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;'

  const shadow = host.attachShadow({ mode: 'closed' })
  const accept = options.accept || ''
  const multiple = Boolean(options.multiple)
  const title = options.title || '选择要导入的文件'
  const hint = buildHint(accept, multiple)

  shadow.innerHTML = `
    <style>${pickerStyles}</style>
    <div class="overlay" part="overlay">
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="mp-picker-title">
        <div class="badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 14.5V17a3 3 0 003 3h10a3 3 0 003-3v-2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 id="mp-picker-title" class="title">${escapeHtml(title)}</h2>
        <p class="subtitle">${escapeHtml(hint)}</p>

        <label class="dropzone" for="mp-picker-input">
          <input
            id="mp-picker-input"
            class="file-input"
            type="file"
            ${accept ? `accept="${escapeAttr(accept)}"` : ''}
            ${multiple ? 'multiple' : ''}
          />
          <div class="dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <path d="M7 18a4.5 4.5 0 01.4-9 5.5 5.5 0 0110.5 1.8A3.8 3.8 0 0118.5 18H7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M12 14V9m0 0l-2.2 2.2M12 9l2.2 2.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="dropzone-text">
            <span class="dropzone-main">点击选择文件</span>
            <span class="dropzone-sub">${multiple ? '可一次选择多个文件' : '选择后将自动回传扩展'}</span>
          </div>
          <span class="dropzone-cta">浏览文件</span>
        </label>

        <div class="meta">
          <span class="meta-dot"></span>
          <span>由 MoviePilot Tools 发起 · 文件仅在本地处理</span>
        </div>

        <button type="button" class="cancel" id="mp-picker-cancel">取消</button>
      </div>
    </div>
  `

  const overlay = shadow.querySelector('.overlay') as HTMLElement
  const panel = shadow.querySelector('.panel') as HTMLElement
  const input = shadow.querySelector('#mp-picker-input') as HTMLInputElement
  const cancel = shadow.querySelector('#mp-picker-cancel') as HTMLButtonElement

  const close = (): void => host.remove()

  cancel.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: PAGE_FILE_PICKER_CANCEL, requestId })
    close()
  })

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) cancel.click()
  })

  panel.addEventListener('click', (event) => event.stopPropagation())

  input.addEventListener('change', () => {
    const files = Array.from(input.files || [])
    if (!files.length) return
    close()
    void streamFiles(requestId, options.action || '', options.view || '', files)
  })

  // 拖拽增强（桌面友好，不影响移动端原生选择）
  const dropzone = shadow.querySelector('.dropzone') as HTMLElement
  ;['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault()
      dropzone.classList.add('is-dragover')
    })
  })
  ;['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault()
      dropzone.classList.remove('is-dragover')
    })
  })
  dropzone.addEventListener('drop', (event) => {
    const dt = (event as DragEvent).dataTransfer
    let files = Array.from(dt?.files || [])
    if (!files.length) return
    if (!multiple) files = files.slice(0, 1)
    close()
    void streamFiles(requestId, options.action || '', options.view || '', files)
  })

  document.documentElement.append(host)
  requestAnimationFrame(() => overlay.classList.add('is-open'))
}

function buildHint(accept: string, multiple: boolean): string {
  const parts: string[] = []
  if (accept) {
    const pretty = accept
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' · ')
    if (pretty) parts.push(`支持 ${pretty}`)
  } else {
    parts.push('支持常见文件格式')
  }
  parts.push(multiple ? '可多选' : '单文件')
  return parts.join(' · ')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

async function streamFiles(
  requestId: string,
  action: string,
  view: string,
  files: File[],
): Promise<void> {
  const port = chrome.runtime.connect({ name: pageFilePickerPortName(requestId) })
  try {
    port.postMessage({ kind: 'task', action, view })
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      port.postMessage({ kind: 'meta', index, name: file.name, type: file.type, size: file.size })
      const bytes = new Uint8Array(await file.arrayBuffer())
      for (let offset = 0; offset < bytes.length; offset += PAGE_FILE_CHUNK_BYTES) {
        port.postMessage({
          kind: 'chunk',
          index,
          chunk: encodePageFileChunk(bytes.subarray(offset, offset + PAGE_FILE_CHUNK_BYTES)),
        })
      }
    }
    port.postMessage({ kind: 'done' })
  } catch (error) {
    port.postMessage({ kind: 'error', message: String(error) })
  }
}

/** Shadow DOM 内嵌样式使用扩展设计变量，并与宿主页面样式隔离。 */
const pickerStyles = `
  :host { all: initial; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
    background: rgba(15, 23, 42, 0.52);
    -webkit-backdrop-filter: blur(10px) saturate(120%);
    backdrop-filter: blur(10px) saturate(120%);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    opacity: 0;
    transition: opacity .22s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .overlay.is-open { opacity: 1; }
  .overlay.is-open .panel {
    transform: translateY(0) scale(1);
    opacity: 1;
  }

  .panel {
    width: min(380px, 100%);
    padding: 22px 18px 16px;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.55);
    background:
      linear-gradient(165deg, rgba(255,255,255,0.92) 0%, rgba(248,250,252,0.9) 100%);
    box-shadow:
      0 1px 0 rgba(255,255,255,0.65) inset,
      0 20px 50px rgba(15, 23, 42, 0.28),
      0 4px 14px rgba(15, 23, 42, 0.12);
    color: #0f172a;
    transform: translateY(12px) scale(0.97);
    opacity: 0;
    transition:
      transform .28s cubic-bezier(0.32, 0.72, 0, 1),
      opacity .28s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .badge {
    width: 44px;
    height: 44px;
    margin: 0 auto 12px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    color: #2563eb;
    background:
      linear-gradient(145deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08));
    border: 1px solid rgba(37, 99, 235, 0.18);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.12);
  }

  .title {
    margin: 0;
    text-align: center;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.35;
    color: #0f172a;
  }

  .subtitle {
    margin: 6px 0 16px;
    text-align: center;
    font-size: 12.5px;
    line-height: 1.5;
    color: #64748b;
  }

  .dropzone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-height: 148px;
    padding: 20px 16px 16px;
    border-radius: 14px;
    border: 1.5px dashed rgba(37, 99, 235, 0.35);
    background:
      linear-gradient(180deg, rgba(59,130,246,0.08), rgba(248,250,252,0.65));
    cursor: pointer;
    transition:
      border-color .18s ease,
      background .18s ease,
      box-shadow .18s ease,
      transform .18s ease;
  }
  .dropzone:hover,
  .dropzone:focus-within {
    border-color: rgba(37, 99, 235, 0.55);
    background:
      linear-gradient(180deg, rgba(59,130,246,0.12), rgba(239,246,255,0.85));
    box-shadow: 0 8px 22px rgba(37, 99, 235, 0.12);
  }
  .dropzone.is-dragover {
    border-color: #2563eb;
    border-style: solid;
    background: rgba(219, 234, 254, 0.9);
    transform: scale(1.01);
  }

  /* 原生 input 铺满整个 dropzone，保证移动端手势可点 */
  .file-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0.01;
    cursor: pointer;
    font-size: 16px;
    z-index: 2;
  }

  .dropzone-icon {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    color: #2563eb;
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(37, 99, 235, 0.12);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
    pointer-events: none;
  }

  .dropzone-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    pointer-events: none;
    text-align: center;
  }
  .dropzone-main {
    font-size: 14px;
    font-weight: 650;
    color: #1e293b;
  }
  .dropzone-sub {
    font-size: 12px;
    color: #64748b;
  }

  .dropzone-cta {
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 14px;
    margin-top: 2px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    color: #fff;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    box-shadow: 0 6px 14px rgba(37, 99, 235, 0.28);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 12px 0 14px;
    font-size: 11px;
    color: #94a3b8;
  }
  .meta-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18);
  }

  .cancel {
    display: block;
    width: 100%;
    height: 40px;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
    background: rgba(248, 250, 252, 0.9);
    color: #475569;
    font-size: 13.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease, color .15s ease;
  }
  .cancel:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #334155;
  }
  .cancel:active {
    background: #e2e8f0;
  }

  @media (prefers-color-scheme: dark) {
    .overlay {
      background: rgba(2, 6, 23, 0.68);
    }
    .panel {
      border-color: rgba(148, 163, 184, 0.18);
      background:
        linear-gradient(165deg, rgba(30,41,59,0.96) 0%, rgba(15,23,42,0.94) 100%);
      box-shadow:
        0 1px 0 rgba(255,255,255,0.04) inset,
        0 24px 56px rgba(0, 0, 0, 0.5),
        0 6px 18px rgba(0, 0, 0, 0.28);
      color: #e2e8f0;
    }
    .badge {
      color: #60a5fa;
      background: linear-gradient(145deg, rgba(59,130,246,0.22), rgba(30,41,59,0.7));
      border-color: rgba(96, 165, 250, 0.22);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
    }
    .title { color: #f1f5f9; }
    .subtitle { color: #94a3b8; }
    .dropzone {
      border-color: rgba(96, 165, 250, 0.35);
      background: linear-gradient(180deg, rgba(59,130,246,0.12), rgba(15,23,42,0.55));
    }
    .dropzone:hover,
    .dropzone:focus-within {
      border-color: rgba(96, 165, 250, 0.55);
      background: linear-gradient(180deg, rgba(59,130,246,0.18), rgba(30,41,59,0.7));
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
    }
    .dropzone.is-dragover {
      border-color: #60a5fa;
      background: rgba(30, 58, 138, 0.45);
    }
    .dropzone-icon {
      color: #93c5fd;
      background: rgba(15, 23, 42, 0.72);
      border-color: rgba(96, 165, 250, 0.18);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .dropzone-main { color: #e2e8f0; }
    .dropzone-sub { color: #94a3b8; }
    .dropzone-cta {
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.35);
    }
    .meta { color: #64748b; }
    .cancel {
      border-color: #334155;
      background: rgba(15, 23, 42, 0.75);
      color: #cbd5e1;
    }
    .cancel:hover {
      background: #1e293b;
      border-color: #475569;
      color: #e2e8f0;
    }
    .cancel:active { background: #0f172a; }
  }

  @media (max-width: 420px) {
    .panel {
      width: 100%;
      padding: 20px 14px 14px;
      border-radius: 16px;
    }
    .dropzone { min-height: 136px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay, .panel, .dropzone, .cancel { transition: none; }
  }
`
