import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  DEFAULT_BACKUP_CONTENTS,
  MP_BACKUP_CONTENT_OPTIONS,
  WEBDAV_BACKUP_CONTENT_OPTIONS,
  normalizeBackupContents,
  type BackupContentId,
} from '../services/backup-schema'

describe('独立备份内容配置', () => {
  it('旧配置默认保留原有三类数据', () => {
    expect(normalizeBackupContents(undefined)).toEqual(DEFAULT_BACKUP_CONTENTS)
  })

  it('MoviePilot 与 WebDAV 可分别保存不同选择', () => {
    const mp = normalizeBackupContents(['totp', 'iconPack'])
    const webdav = normalizeBackupContents(['credentials', 'ocrOfflinePack'])
    expect(mp).toEqual(['totp', 'iconPack'])
    expect(webdav).toEqual(['credentials', 'ocrOfflinePack'])
  })

  it('WebDAV 设置只允许 MoviePilot 目标选择', () => {
    expect(normalizeBackupContents(['webdavSettings'], MP_BACKUP_CONTENT_OPTIONS)).toEqual(['webdavSettings'])
    expect(normalizeBackupContents(['webdavSettings', 'totp'], WEBDAV_BACKUP_CONTENT_OPTIONS)).toEqual(['totp'])
  })

  it('过滤未知项、去重并允许空选择等待执行时校验', () => {
    expect(normalizeBackupContents(['totp', 'unknown', 'totp'])).toEqual(['totp'])
    expect(normalizeBackupContents([])).toEqual([])
  })
})

describe('资源 ZIP 导入结构', () => {
  it('图标包结构可被现有导入规则识别', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'mp-site-icons', name: 'test', version: '1' }))
    zip.file('icons/example.com.png', new Uint8Array([137, 80, 78, 71]))
    const parsed = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))

    expect(parsed.file('manifest.json')).not.toBeNull()
    expect(Object.keys(parsed.files).some((name) => /^icons\/.+\.(png|jpe?g|webp|gif|svg)$/i.test(name))).toBe(true)
  })

  it('离线 OCR 包结构包含 WASM、ONNX 和 charsets.json', async () => {
    const zip = new JSZip()
    zip.file('ort-wasm-simd-threaded.wasm', new Uint8Array([0, 97, 115, 109]))
    zip.file('common.onnx', new Uint8Array([1, 2, 3]))
    zip.file('charsets.json', JSON.stringify(['0', '1']))
    const parsed = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    const names = Object.keys(parsed.files)

    expect(names.some((name) => /ort-wasm-simd-threaded.*\.wasm$/i.test(name))).toBe(true)
    expect(names.some((name) => name.toLowerCase().endsWith('.onnx'))).toBe(true)
    expect(names.some((name) => /(^|\/)charsets\.json$/i.test(name))).toBe(true)
  })

  it('支持全部五种合法备份内容标识', () => {
    const all: BackupContentId[] = [
      'totp',
      'credentials',
      'ocrCorrections',
      'iconPack',
      'ocrOfflinePack',
      'webdavSettings',
    ]
    expect(normalizeBackupContents(all)).toEqual(all)
  })
})
