import { describe, expect, it } from 'vitest'
import {
  decodePageFileChunks,
  encodePageFileChunk,
  PAGE_FILE_CHUNK_BYTES,
} from '../core/page-file-chunks'

function split(bytes: Uint8Array): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += PAGE_FILE_CHUNK_BYTES) {
    chunks.push(encodePageFileChunk(bytes.subarray(offset, offset + PAGE_FILE_CHUNK_BYTES)))
  }
  return chunks
}

describe('页面文件选择器分片', () => {
  it('单分片往返保持字节', () => {
    const source = Uint8Array.from([0, 1, 2, 127, 128, 255])
    expect(new Uint8Array(decodePageFileChunks(split(source), source.length))).toEqual(source)
  })

  it('多分片往返保持顺序和长度', () => {
    const source = new Uint8Array(PAGE_FILE_CHUNK_BYTES * 2 + 17)
    for (let index = 0; index < source.length; index += 1) source[index] = index % 251
    const chunks = split(source)

    expect(chunks).toHaveLength(3)
    expect(new Uint8Array(decodePageFileChunks(chunks, source.length))).toEqual(source)
  })

  it('拒绝不完整分片', () => {
    expect(() => decodePageFileChunks([encodePageFileChunk(Uint8Array.from([1, 2]))], 3)).toThrow(
      '文件分片长度与声明大小不一致',
    )
  })

  it('拒绝超过声明大小的分片', () => {
    expect(() => decodePageFileChunks([encodePageFileChunk(Uint8Array.from([1, 2, 3]))], 2)).toThrow(
      '文件分片长度超过声明大小',
    )
  })
})
