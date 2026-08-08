import {
  PAGE_FILE_PICK_REQUEST,
  type PageFilePickerOptions,
} from './page-file-picker-contracts'

export type { PageFilePickerOptions } from './page-file-picker-contracts'

export interface PickedPageFile {
  name: string
  type: string
  bytes: ArrayBuffer
}

interface PendingRecord {
  action: string
  files: PickedPageFile[]
  createdAt: number
}

const DB_NAME = 'mp-page-file-picker'
const DB_VERSION = 1
const STORE_PENDING = 'pending'

/**
 * 选择导入文件：PC 直接使用扩展页原生文件控件；移动端创建普通网页桥接任务。
 * 移动端 popup 随后可能被浏览器关闭，因此返回空数组，文件由页面重开后领取。
 */
export async function requestFilesFromActivePage(
  options: PageFilePickerOptions,
): Promise<PickedPageFile[]> {
  if (!document.documentElement.classList.contains('mobile-root')) {
    return pickFilesLocally(options)
  }

  const response = await chrome.runtime.sendMessage({
    type: PAGE_FILE_PICK_REQUEST,
    requestId: crypto.randomUUID(),
    options,
  })
  if (!response?.ok) throw new Error(response?.message || '无法打开网页文件选择器')
  return []
}

/** PC 端在当前用户手势中直接打开原生文件选择器。 */
function pickFilesLocally(options: PageFilePickerOptions): Promise<PickedPageFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept
    input.multiple = Boolean(options.multiple)
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (files: PickedPageFile[]): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener(
      'change',
      () => {
        const files = Array.from(input.files || [])
        if (!files.length) {
          finish([])
          return
        }
        void Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            bytes: await file.arrayBuffer(),
          })),
        ).then(finish, (error) => {
          input.remove()
          reject(error)
        })
      },
      { once: true },
    )
    input.addEventListener('cancel', () => finish([]), { once: true })
    input.click()
  })
}

/** 页面重新打开后领取对应导入任务；领取即删除，避免重复导入。 */
export async function consumePickedPageFiles(action: string): Promise<PickedPageFile[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING, 'readwrite')
      const store = tx.objectStore(STORE_PENDING)
      const req = store.get(action)
      let files: PickedPageFile[] = []
      req.onerror = () => reject(req.error || new Error('读取待导入文件失败'))
      req.onsuccess = () => {
        const record = req.result as PendingRecord | undefined
        files = record?.files || []
        if (record) store.delete(action)
      }
      tx.oncomplete = () => resolve(files)
      tx.onerror = () => reject(tx.error || new Error('消费待导入文件失败'))
      tx.onabort = () => reject(tx.error || new Error('消费待导入文件中止'))
    })
  } finally {
    db.close()
  }
}

/** 仅供 background 保存网页端已选文件。 */
export async function savePickedPageFiles(action: string, files: PickedPageFile[]): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING, 'readwrite')
      tx.objectStore(STORE_PENDING).put({ action, files, createdAt: Date.now() } satisfies PendingRecord)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('保存待导入文件失败'))
      tx.onabort = () => reject(tx.error || new Error('保存待导入文件中止'))
    })
  } finally {
    db.close()
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error || new Error('打开文件任务数据库失败'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'action' })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}
