import { base64UrlToBytes, bytesToBase64Url, sha256Bytes } from './crypto'
import type { DeviceStoreV1 } from './storage-contracts'
import { storeRepository, type StoreRepository } from './store-repository'

const ROOT_KEY_BYTES = 32
const KEY_ID_BYTES = 8

function randomId(bytes: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function calculateRootKeyId(rootKey: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(rootKey)
  return [...digest.slice(0, KEY_ID_BYTES)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function parseDeviceRootKey(store: DeviceStoreV1): Uint8Array<ArrayBuffer> {
  if (store.schema !== 1 || !store.deviceId || !store.createdAt) throw new Error('设备存储格式不正确')
  let rootKey: Uint8Array<ArrayBuffer>
  try {
    rootKey = base64UrlToBytes(store.rootKey)
  } catch {
    throw new Error('设备根密钥编码不正确')
  }
  if (rootKey.byteLength !== ROOT_KEY_BYTES) throw new Error('设备根密钥长度必须为 32 字节')
  return rootKey
}

export async function createDeviceStore(now = new Date()): Promise<DeviceStoreV1> {
  const rootKey = crypto.getRandomValues(new Uint8Array(ROOT_KEY_BYTES))
  return {
    schema: 1,
    deviceId: randomId(16),
    rootKey: bytesToBase64Url(rootKey),
    createdAt: now.toISOString(),
  }
}

export async function getOrCreateDeviceStore(
  repository: StoreRepository = storeRepository,
): Promise<DeviceStoreV1> {
  const existing = await repository.getDeviceStore()
  if (existing) {
    parseDeviceRootKey(existing)
    return existing
  }
  const created = await createDeviceStore()
  await repository.setDeviceStore(created)
  return created
}
