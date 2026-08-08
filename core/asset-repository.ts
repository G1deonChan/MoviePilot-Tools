import { sha256HexBytes } from './crypto'
import { getAssetsStore, updateAssetsStore } from './store-repository'
import type { AssetIndexEntry } from './storage-contracts'

const DB_NAME = 'mpt2-assets-v1'
const DB_VERSION = 1
const STORE = 'assets'
const BACKGROUND_ID = 'background:selected'

interface AssetRecord {
  id: string
  data: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开资产数据库失败'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('资产数据库事务失败'))
    tx.onabort = () => reject(tx.error || new Error('资产数据库事务中止'))
  })
}

async function putRecord(record: AssetRecord): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    await txDone(tx)
  } finally {
    db.close()
  }
}

async function getRecord(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    const record = await new Promise<AssetRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as AssetRecord | undefined)
      request.onerror = () => reject(request.error || new Error('读取资产失败'))
    })
    await txDone(tx)
    return record?.data || null
  } finally {
    db.close()
  }
}

async function deleteRecord(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; mediaType: string } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) throw new Error('背景图片不是有效 Data URL')
  const binary = atob(match[2])
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>
  return { bytes, mediaType: match[1] }
}

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return `data:${mediaType};base64,${btoa(binary)}`
}

export async function saveBackgroundAsset(dataUrl: string): Promise<void> {
  const { bytes, mediaType } = dataUrlToBytes(dataUrl)
  const entry: AssetIndexEntry = {
    id: BACKGROUND_ID,
    kind: 'background',
    name: 'background',
    mediaType,
    size: bytes.byteLength,
    sha256: await sha256HexBytes(bytes),
    updatedAt: new Date().toISOString(),
  }
  await putRecord({ id: BACKGROUND_ID, data: bytes.buffer })
  await updateAssetsStore((draft) => {
    draft.selectedBackgroundId = BACKGROUND_ID
    draft.entries = [...(draft.entries || []).filter((item) => item.id !== BACKGROUND_ID), entry]
  })
}

export async function getBackgroundAsset(): Promise<string> {
  const store = await getAssetsStore()
  const id = store.selectedBackgroundId
  const entry = store.entries?.find((item) => item.id === id)
  if (!id || !entry) return ''
  const data = await getRecord(id)
  return data ? bytesToDataUrl(new Uint8Array(data), entry.mediaType) : ''
}

export async function exportBackgroundAsset(): Promise<{ entry: AssetIndexEntry; data: ArrayBuffer } | null> {
  const store = await getAssetsStore()
  const id = store.selectedBackgroundId
  const entry = store.entries?.find((item) => item.id === id)
  if (!id || !entry) return null
  const data = await getRecord(id)
  return data ? { entry, data } : null
}

export async function clearBackgroundAsset(): Promise<void> {
  await deleteRecord(BACKGROUND_ID)
  await updateAssetsStore((draft) => {
    delete draft.selectedBackgroundId
    draft.entries = draft.entries?.filter((item) => item.id !== BACKGROUND_ID)
  })
}

export async function clearAssetRepository(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('删除资产数据库失败'))
    request.onblocked = () => reject(new Error('资产数据库正在使用'))
  })
  await updateAssetsStore(() => ({ schema: 1 }))
}
