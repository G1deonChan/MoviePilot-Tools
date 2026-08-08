import { describe, expect, it } from 'vitest'
import { base64UrlToBytes, bytesToBase64Url } from '../core/crypto'
import { decryptLocalVault, encryptLocalVault } from '../core/local-vault'
import type { PrivateStoreV1 } from '../core/storage-contracts'

const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const store: PrivateStoreV1 = {
  schema: 1,
  services: {
    aiToken: ' secret-token ',
    webdav: { url: 'https://dav.example.com', username: 'user', password: 'password' },
  },

  backup: { rootKey: bytesToBase64Url(new Uint8Array(32).fill(7)), keyId: '0011223344556677' },
}

describe('LocalVaultEnvelopeV1', () => {
  it('随机 DEK 信封可完成严格往返且每次密文不同', async () => {
    const first = await encryptLocalVault(store, rootKey)
    const second = await encryptLocalVault(store, rootKey)
    expect(first).not.toEqual(second)
    expect(await decryptLocalVault(first, rootKey)).toEqual(store)
  })

  it('错误设备根密钥被拒绝且不回退明文', async () => {
    const envelope = await encryptLocalVault(store, rootKey)
    await expect(decryptLocalVault(envelope, new Uint8Array(32).fill(9))).rejects.toThrow(
      '本地私有仓不属于当前设备',
    )
  })

  it('错误格式、AAD 上下文和篡改正文均被拒绝', async () => {
    const envelope = await encryptLocalVault(store, rootKey)
    await expect(
      decryptLocalVault({ ...envelope, format: 'legacy' as 'mpt2-local-vault' }, rootKey),
    ).rejects.toThrow('本地私有仓格式不受支持')

    const tampered = base64UrlToBytes(envelope.payload.ciphertext)
    tampered[0] ^= 1
    await expect(
      decryptLocalVault(
        { ...envelope, payload: { ...envelope.payload, ciphertext: bytesToBase64Url(tampered) } },
        rootKey,
      ),
    ).rejects.toBeTruthy()
  })

  it('禁止写入空私有仓', async () => {
    await expect(encryptLocalVault({ schema: 1 }, rootKey)).rejects.toThrow('私有仓为空，无需加密')
  })
})
