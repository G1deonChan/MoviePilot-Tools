export const PAGE_FILE_CHUNK_BYTES = 192 * 1024

export function encodePageFileChunk(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

export function decodePageFileChunks(chunks: string[], size: number): ArrayBuffer {
  const buffer = new ArrayBuffer(size)
  const result = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    const binary = atob(chunk)
    if (offset + binary.length > size) throw new Error('文件分片长度超过声明大小')
    for (let index = 0; index < binary.length; index += 1) {
      result[offset + index] = binary.charCodeAt(index)
    }
    offset += binary.length
  }
  if (offset !== size) throw new Error('文件分片长度与声明大小不一致')
  return buffer
}
