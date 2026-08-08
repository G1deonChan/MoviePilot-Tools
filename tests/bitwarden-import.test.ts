import { describe, expect, it, vi } from 'vitest'
import type { PtCredential, TotpSite } from '../core/types'
import {
  credentialConflictKey,
  importBitwardenCredentials,
  normalizeCredentialOrigin,
} from '../services/bitwarden-import'

function exportJson(items: unknown[], encrypted = false): string {
  return JSON.stringify({ encrypted, folders: [], items })
}

function loginItem(overrides: Record<string, unknown> = {}) {
  return {
    type: 1,
    name: '示例站点',
    creationDate: '2025-01-01T00:00:00.000Z',
    revisionDate: '2026-01-01T00:00:00.000Z',
    login: {
      username: 'User@example.com',
      password: 'secret',
      uris: [{ uri: 'https://www.example.com/login?from=test' }],
    },
    ...overrides,
  }
}

const customResolver = vi.fn(async (inputs: Array<{ domain: string; name: string }>) =>
  inputs.map(({ name }) => ({ category: 'custom' as const, name, isPt: false })),
)

describe('Bitwarden 凭据导入', () => {
  it('拒绝加密文件和非 Bitwarden JSON', async () => {
    await expect(importBitwardenCredentials(exportJson([], true), [], customResolver)).rejects.toThrow(
      '暂不支持 Bitwarden 加密 JSON',
    )
    await expect(importBitwardenCredentials('{}', [], customResolver)).rejects.toThrow(
      '不是有效的 Bitwarden JSON',
    )
  })

  it('归一化 URI、生成新 ID 并保留日期', async () => {
    const result = await importBitwardenCredentials(exportJson([loginItem()]), [], customResolver)
    expect(result.stats.added).toBe(1)
    expect(result.credentials[0]).toMatchObject({
      name: '示例站点',
      domain: 'https://www.example.com',
      username: 'User@example.com',
      password: 'secret',
      category: 'custom',
      autoSaveEnabled: true,
      autoFillEnabled: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.credentials[0].id).toBeTruthy()
  })

  it('支持批量 PT 站点分类结果', async () => {
    const resolver = vi.fn(async () => [
      { category: 'pt' as const, name: '官方站名', isPt: true, matchedKey: 'example.com' },
    ])
    const result = await importBitwardenCredentials(exportJson([loginItem()]), [], resolver)
    expect(result.credentials[0]).toMatchObject({ name: '官方站名', category: 'pt' })
  })

  it('同站不同用户名保留为不同凭据', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem(),
        loginItem({
          login: {
            username: 'second@example.com',
            password: 'other',
            uris: [{ uri: 'https://example.com/account' }],
          },
        }),
      ]),
      [],
      customResolver,
    )
    expect(result.stats.added).toBe(2)
    expect(result.credentials).toHaveLength(2)
  })

  it('仅在 revisionDate 严格更新时覆盖并保留现有 ID', async () => {
    const existing: PtCredential = {
      id: 'existing-id',
      name: '旧名称',
      domain: 'https://example.com',
      username: 'user@example.com',
      password: 'old',
      category: 'custom',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const result = await importBitwardenCredentials(exportJson([loginItem()]), [existing], customResolver)
    expect(result.stats.updated).toBe(1)
    expect(result.credentials[0]).toMatchObject({
      id: 'existing-id',
      password: 'secret',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    const older = await importBitwardenCredentials(
      exportJson([loginItem({ revisionDate: '2024-01-01T00:00:00.000Z' })]),
      [existing],
      customResolver,
    )
    expect(older.stats.keptExisting).toBe(1)
    expect(older.credentials[0].password).toBe('old')
    expect(older.details.duplicates).toEqual([
      expect.objectContaining({
        domain: 'https://www.example.com',
        maskedUsername: 'us***@example.com',
        reason: '扩展中已有相同站点和用户名，现有凭据日期更新或相同',
      }),
    ])
  })

  it('无效 revisionDate 不覆盖现有凭据', async () => {
    const existing: PtCredential = {
      id: 'existing-id',
      name: '现有',
      domain: 'https://example.com',
      username: 'user@example.com',
      password: 'old',
      category: 'custom',
      updatedAt: '2020-01-01T00:00:00.000Z',
    }
    const result = await importBitwardenCredentials(
      exportJson([loginItem({ revisionDate: 'invalid' })]),
      [existing],
      customResolver,
    )
    expect(result.stats.keptExisting).toBe(1)
    expect(result.credentials[0].password).toBe('old')
  })

  it('跳过非登录、缺字段和非网页 URI', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        { type: 2 },
        loginItem({ login: null }),
        loginItem({ login: { username: '', password: 'x', uris: [{ uri: 'https://a.test' }] } }),
        loginItem({ login: { username: 'u', password: '', uris: [{ uri: 'https://a.test' }] } }),
        loginItem({ login: { username: 'u', password: 'p', uris: [{ uri: 'androidapp://app' }] } }),
      ]),
      [],
      customResolver,
    )
    expect(result.credentials).toHaveLength(0)
    expect(result.stats).toMatchObject({
      skippedNonLogin: 1,
      skippedMissingLogin: 1,
      skippedMissingUsername: 1,
      skippedMissingPassword: 1,
      skippedMissingWebUri: 1,
    })
    expect(result.details.skipped.map((item) => item.reason)).toEqual([
      '不是登录凭据',
      '缺少登录信息',
      '缺少用户名',
      '缺少密码',
      '缺少有效网页地址',
    ])
    expect(JSON.stringify(result.details)).not.toContain('secret')
  })

  it('规范化冲突键并优先 HTTPS URI', async () => {
    expect(normalizeCredentialOrigin('https://example.com/a?q=1')).toBe('https://example.com')
    expect(normalizeCredentialOrigin('androidapp://app')).toBeNull()
    expect(credentialConflictKey('https://www.Example.com/path', ' USER ')).toBe('example.com::user')

    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: 'u',
            password: 'p',
            uris: [{ uri: 'http://example.com' }, { uri: 'https://example.com/login' }],
          },
        }),
      ]),
      [],
      customResolver,
    )
    expect(result.credentials[0].domain).toBe('https://example.com')
  })

  it('导入登录项中的 TOTP 并沿用网页域名与站点分类', async () => {
    const resolver = vi.fn(async (inputs: Array<{ domain: string; name: string }>) =>
      inputs.map(() => ({ category: 'pt' as const, name: '官方站名', isPt: true })),
    )
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: 'user@example.com',
            password: 'secret',
            totp: 'otpauth://totp/Issuer:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Issuer',
            uris: [{ uri: 'https://www.example.com/login' }],
          },
        }),
      ]),
      [],
      resolver,
    )

    expect(result.totpStats).toMatchObject({ eligible: 1, added: 1, updated: 0, skippedInvalid: 0 })
    expect(result.totpSites).toHaveLength(1)
    expect(result.totpSites[0]).toMatchObject({
      name: '官方站名',
      domain: 'www.example.com',
      url: 'https://www.example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      category: 'pt',
      group: 'pt',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(result.totpSites[0].id).toBeTruthy()
  })

  it('凭据字段不完整时仍可独立导入有效 TOTP', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: '',
            password: '',
            totp: 'otpauth://totp/OnlyTotp?secret=JBSWY3DPEHPK3PXP',
            uris: [{ uri: 'https://totp.example.com/login' }],
          },
        }),
      ]),
      [],
      customResolver,
    )

    expect(result.credentials).toHaveLength(0)
    expect(result.stats.skippedMissingUsername).toBe(1)
    expect(result.totpStats.added).toBe(1)
    expect(result.totpSites[0]).toMatchObject({
      domain: 'totp.example.com',
      url: 'https://totp.example.com',
    })
  })

  it('支持 Bitwarden 纯 Base32 TOTP 密钥', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: 'user',
            password: 'password',
            totp: 'jbsw y3dp ehpk 3pxp',
            uris: [{ uri: 'https://base32.example.com' }],
          },
        }),
      ]),
      [],
      customResolver,
    )

    expect(result.totpStats.added).toBe(1)
    expect(result.totpSites[0]).toMatchObject({
      name: '示例站点',
      secret: 'JBSWY3DPEHPK3PXP',
      domain: 'base32.example.com',
    })
  })

  it('跳过 HOTP 和无效 Base32，且预览明细不泄露 TOTP 密钥', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: 'u1',
            password: 'p1',
            totp: 'otpauth://hotp/User?secret=JBSWY3DPEHPK3PXP&counter=1',
            uris: [{ uri: 'https://hotp.example.com' }],
          },
        }),
        loginItem({
          name: '无效密钥',
          login: {
            username: 'u2',
            password: 'p2',
            totp: 'otpauth://totp/User?secret=NOT-BASE32',
            uris: [{ uri: 'https://invalid.example.com' }],
          },
        }),
      ]),
      [],
      customResolver,
    )

    expect(result.totpSites).toHaveLength(0)
    expect(result.totpStats.skippedInvalid).toBe(2)
    expect(result.details.totpSkipped).toHaveLength(2)
    expect(JSON.stringify(result.details)).not.toContain('JBSWY3DPEHPK3PXP')
    expect(JSON.stringify(result.details)).not.toContain('NOT-BASE32')
  })

  it('相同域名与名称的 TOTP 仅在 Bitwarden 日期更新时覆盖并保留 ID', async () => {
    const existing: TotpSite = {
      id: 'totp-existing-id',
      name: '示例站点',
      domain: 'example.com',
      url: 'https://example.com',
      secret: 'AAAAAAAAAAAAAAAA',
      category: 'custom',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const updated = await importBitwardenCredentials(
      exportJson([
        loginItem({
          login: {
            username: 'user@example.com',
            password: 'secret',
            totp: 'otpauth://totp/示例站点?secret=JBSWY3DPEHPK3PXP',
            uris: [{ uri: 'https://www.example.com/login' }],
          },
        }),
      ]),
      [],
      customResolver,
      [existing],
    )
    expect(updated.totpStats.updated).toBe(1)
    expect(updated.totpSites[0]).toMatchObject({
      id: 'totp-existing-id',
      secret: 'JBSWY3DPEHPK3PXP',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    const older = await importBitwardenCredentials(
      exportJson([
        loginItem({
          revisionDate: '2024-01-01T00:00:00.000Z',
          login: {
            username: 'user@example.com',
            password: 'secret',
            totp: 'otpauth://totp/示例站点?secret=MZXW6YTBOI======',
            uris: [{ uri: 'https://example.com/login' }],
          },
        }),
      ]),
      [],
      customResolver,
      [existing],
    )
    expect(older.totpStats.keptExisting).toBe(1)
    expect(older.totpSites[0].secret).toBe('AAAAAAAAAAAAAAAA')
  })

  it('同一域名下不同名称的 TOTP 保留为独立条目', async () => {
    const result = await importBitwardenCredentials(
      exportJson([
        loginItem({
          name: '账号 A',
          login: {
            username: 'a',
            password: 'p',
            totp: 'otpauth://totp/账号 A?secret=JBSWY3DPEHPK3PXP',
            uris: [{ uri: 'https://example.com' }],
          },
        }),
        loginItem({
          name: '账号 B',
          login: {
            username: 'b',
            password: 'p',
            totp: 'otpauth://totp/账号 B?secret=MZXW6YTBOI======',
            uris: [{ uri: 'https://example.com' }],
          },
        }),
      ]),
      [],
      customResolver,
    )

    expect(result.totpStats.added).toBe(2)
    expect(result.totpSites).toHaveLength(2)
  })
})
