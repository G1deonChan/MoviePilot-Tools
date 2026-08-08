import { describe, it, expect } from 'vitest'
import {
  bufToB64,
  b64ToBuf,
  sha256Hex,
  deriveAesKey,
  aesEncrypt,
  aesDecrypt,
  randomBytes,
} from '../core/crypto'
import { generateTotp, totpRemaining } from '../services/totp'

describe('base64 编解码', () => {
  it('往返一致', () => {
    const src = randomBytes(32)
    expect([...b64ToBuf(bufToB64(src))]).toEqual([...src])
  })
})

describe('sha256Hex', () => {
  it('已知向量：空串', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
  it('已知向量：abc', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('AES-GCM 加解密', () => {
  it('往返一致', async () => {
    const key = await deriveAesKey('pin-1234', randomBytes(16), 1000)
    const plain = '敏感数据 secret-😀'
    const cipher = await aesEncrypt(key, plain)
    expect(cipher).toContain(':')
    expect(await aesDecrypt(key, cipher)).toBe(plain)
  })
  it('错误密钥无法解密', async () => {
    const salt = randomBytes(16)
    const k1 = await deriveAesKey('a', salt, 1000)
    const k2 = await deriveAesKey('b', salt, 1000)
    const cipher = await aesEncrypt(k1, 'hello')
    await expect(aesDecrypt(k2, cipher)).rejects.toBeTruthy()
  })
  it('密文格式错误抛出', async () => {
    const key = await deriveAesKey('a', randomBytes(16), 1000)
    await expect(aesDecrypt(key, 'no-colon')).rejects.toThrow()
  })
})

describe('TOTP（RFC 6238 测试向量，SHA-1）', () => {
  // seed "12345678901234567890" 的 Base32
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  it('T=59 → 287082', async () => {
    expect(await generateTotp(secret, 6, 30, 59 * 1000)).toBe('287082')
  })
  it('T=1111111109 → 081804', async () => {
    expect(await generateTotp(secret, 6, 30, 1111111109 * 1000)).toBe('081804')
  })
  it('T=1234567890 → 005924', async () => {
    expect(await generateTotp(secret, 6, 30, 1234567890 * 1000)).toBe('005924')
  })
})

describe('totpRemaining', () => {
  it('周期边界', () => {
    expect(totpRemaining(30, 0)).toBe(30)
    expect(totpRemaining(30, 1000)).toBe(29)
    expect(totpRemaining(30, 29_000)).toBe(1)
  })
})
