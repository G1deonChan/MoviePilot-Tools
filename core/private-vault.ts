import { getOrCreateDeviceStore, parseDeviceRootKey } from './device-root'
import { decryptLocalVault, encryptLocalVault } from './local-vault'
import type { PrivateStoreV1 } from './storage-contracts'
import { compactPrivateStore } from './storage-policy'
import { storeRepository, type StoreRepository } from './store-repository'

type PrivateMutator = (
  draft: PrivateStoreV1,
) => void | PrivateStoreV1 | Promise<void | PrivateStoreV1>

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class PrivateVault {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly repository: StoreRepository = storeRepository) {}

  async get(): Promise<PrivateStoreV1> {
    const envelope = await this.repository.getPrivateEnvelope()
    if (!envelope) return { schema: 1 }
    const device = await getOrCreateDeviceStore(this.repository)
    const rootKey = parseDeviceRootKey(device)
    try {
      return await decryptLocalVault(envelope, rootKey)
    } finally {
      rootKey.fill(0)
    }
  }

  update(mutator: PrivateMutator): Promise<PrivateStoreV1> {
    let result: PrivateStoreV1 = { schema: 1 }
    return this.enqueue(async () => {
      const current = await this.get()
      const draft = clone(current)
      const returned = await mutator(draft)
      const next = compactPrivateStore((returned || draft) as PrivateStoreV1)
      if (!next) {
        await this.repository.setPrivateEnvelope(null)
        result = { schema: 1 }
        return
      }

      const device = await getOrCreateDeviceStore(this.repository)
      const rootKey = parseDeviceRootKey(device)
      try {
        await this.repository.setPrivateEnvelope(await encryptLocalVault(next, rootKey))
        result = clone(next)
      } finally {
        rootKey.fill(0)
      }
    }).then(() => result)
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.repository.setPrivateEnvelope(null))
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export const privateVault = new PrivateVault()
export const getPrivateStore = () => privateVault.get()
export const updatePrivateStore = (mutator: PrivateMutator) => privateVault.update(mutator)
export const clearPrivateStore = () => privateVault.clear()
