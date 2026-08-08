/**
 * 从 PNG 目录打 ZIP 图标包（不参与扩展 build）
 *
 * 用法:
 *   node scripts/pack-site-icons.mjs
 *   node scripts/pack-site-icons.mjs --src pack-assets/site_favicon --out release/mp-site-icons-hd.zip
 *
 * 默认源目录: pack-assets/site_favicon（打包素材，不在 public，不打进扩展）
 * 包结构:
 *   manifest.json
 *   icons/<prefix>.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

/** ZIP 使用标准 CRC-32；此实现不依赖 Node 内置 CRC API。 */
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return ~c >>> 0
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const srcDir = path.resolve(root, arg('--src', 'pack-assets/site_favicon'))
const outFile = path.resolve(root, arg('--out', 'release/mp-site-icons-hd.zip'))
const packName = arg('--name', '图标包-HD')
const packVersion = arg('--version', '1')

if (!fs.existsSync(srcDir)) {
  console.error(`源目录不存在: ${srcDir}`)
  process.exit(1)
}

const files = fs
  .readdirSync(srcDir)
  .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
  .sort()

if (!files.length) {
  console.error(`源目录无图片: ${srcDir}`)
  process.exit(1)
}

const manifest = {
  format: 'mp-site-icons',
  version: Number.isFinite(Number(packVersion)) ? Number(packVersion) : packVersion,
  name: packName,
  iconCount: files.length,
  match: 'domain-prefix',
  createdAt: new Date().toISOString(),
}

/** 简易 ZIP writer：store 或 deflate */
function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

function zipEntry(name, data, { compress = true } = {}) {
  const nameBuf = Buffer.from(name, 'utf8')
  let method = 0
  let payload = data
  if (compress) {
    const deflated = deflateRawSync(data, { level: 9 })
    if (deflated.length < data.length) {
      method = 8
      payload = deflated
    }
  }
  const crc = crc32(data) >>> 0
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(payload.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
    payload,
  ])
  return {
    local,
    nameBuf,
    method,
    crc,
    compSize: payload.length,
    uncompSize: data.length,
  }
}

const parts = []
const central = []
let offset = 0

function addFile(name, data) {
  const e = zipEntry(name, data)
  parts.push(e.local)
  const cd = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(e.method),
    u16(0),
    u16(0),
    u32(e.crc),
    u32(e.compSize),
    u32(e.uncompSize),
    u16(e.nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    e.nameBuf,
  ])
  central.push(cd)
  offset += e.local.length
}

addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))

for (const file of files) {
  const prefix = path.parse(file).name.toLowerCase()
  const data = fs.readFileSync(path.join(srcDir, file))
  addFile(`icons/${prefix}${path.extname(file).toLowerCase()}`, data)
}

const centralDir = Buffer.concat(central)
const eocd = Buffer.concat([
  u32(0x06054b50),
  u16(0),
  u16(0),
  u16(central.length),
  u16(central.length),
  u32(centralDir.length),
  u32(offset),
  u16(0),
])

const zip = Buffer.concat([...parts, centralDir, eocd])
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, zip)

console.log(`✅ 已生成: ${outFile}`)
console.log(`📊 图标数: ${files.length}`)
console.log(`📦 大小: ${(zip.length / 1024 / 1024).toFixed(2)} MB`)
console.log(`📁 源: ${srcDir}`)
