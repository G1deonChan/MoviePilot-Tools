import { describe, expect, it } from 'vitest'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decryptAesGcmBox,
  deriveHkdfAesKey,
  encodeUtf8,
  encryptAesGcmBox,
  importAesKey,
} from '../core/crypto'

describe('HKDF 用途隔离', () => {
  const root = Uint8Array.from({ length: 32 }, (_, index) => index)

  it('同一根密钥与用途可完成 AES-GCM 往返', async () => {
    const key = await deriveHkdfAesKey(root, 'local-wrap-v1', ['encrypt', 'decrypt'])
    const box = await encryptAesGcmBox(key, encodeUtf8('private data'), 'mpt2-local-vault|1|private')
    const plain = await decryptAesGcmBox(key, box, 'mpt2-local-vault|1|private')
    expect(new TextDecoder().decode(plain)).toBe('private data')
  })

  it('错误用途派生密钥无法解密', async () => {
    const localKey = await deriveHkdfAesKey(root, 'local-wrap-v1', ['encrypt', 'decrypt'])
    const backupKey = await deriveHkdfAesKey(root, 'backup-wrap-v1', ['encrypt', 'decrypt'])
    const box = await encryptAesGcmBox(localKey, encodeUtf8('private data'), 'context')
    await expect(decryptAesGcmBox(backupKey, box, 'context')).rejects.toBeTruthy()
  })

  it('错误 AAD 与篡改密文均被拒绝', async () => {
    const key = await importAesKey(root, ['encrypt', 'decrypt'])
    const box = await encryptAesGcmBox(key, encodeUtf8('private data'), 'correct-aad')
    await expect(decryptAesGcmBox(key, box, 'wrong-aad')).rejects.toBeTruthy()

    const tampered = base64UrlToBytes(box.ciphertext)
    tampered[0] ^= 1
    await expect(
      decryptAesGcmBox(
        key,
        { ...box, ciphertext: bytesToBase64Url(tampered) },
        'correct-aad',
      ),
    ).rejects.toBeTruthy()
  })
})
