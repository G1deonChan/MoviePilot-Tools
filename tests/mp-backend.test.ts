import { describe, expect, it } from 'vitest'
import { MP_CHUNK_BYTES, splitMpUploadBytes } from '../core/mp-backend'

describe('MoviePilot 大备份分块', () => {
  it('每块不超过 256KB 且可完整拼回 UTF-8 内容', () => {
    const source = `备份内容-${'图标与OCR模型'.repeat(40_000)}`
    const chunks = splitMpUploadBytes(source)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.byteLength <= MP_CHUNK_BYTES)).toBe(true)

    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const merged = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    expect(new TextDecoder().decode(merged)).toBe(source)
  })

  it('空内容仍生成一个合法分块', () => {
    const chunks = splitMpUploadBytes('')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].byteLength).toBe(0)
  })
})
