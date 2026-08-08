import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOTS = ['components', 'content', 'core', 'entrypoints', 'services', 'styles', 'utils', 'views', 'scripts']
const EXTENSIONS = new Set(['.ts', '.vue', '.js', '.css', '.mjs'])
const FORBIDDEN = [
  { name: '优化过程', pattern: /优化/u },
  { name: '参考来源', pattern: /参考/u },
  { name: '借鉴来源', pattern: /借鉴/u },
  { name: '实现对齐', pattern: /对齐/u },
  { name: '比较性一致说明', pattern: /与[^，。；：\n]{1,80}一致/u },
  { name: '沿用说明', pattern: /沿用/u },
  { name: '旧版叙述', pattern: /旧版/u },
  { name: '迁移来源', pattern: /迁移自/u },
  { name: '仿照来源', pattern: /仿照/u },
  { name: '参照来源', pattern: /参照/u },
]
const REPORT_ONLY = [
  { name: '装饰性长分隔线', pattern: /(?:={5,}|-{5,})/u },
  { name: '无信息异常注释', pattern: /^\s*\*?\s*(?:ignore|忽略)(?:\s+[^\n]*)?\s*$/iu },
  { name: '视觉定位注释', pattern: /(?:第一|第二|第三|左侧|右侧|顶行|底行)/u },
  { name: '模糊兼容说明', pattern: /兼容(?:旧|历史)(?:版|格式|数据|字段)?/u },
]

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolute))
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(absolute)
  }
  return files
}

function extractComments(source) {
  const comments = []
  let index = 0
  let line = 1
  let quote = ''
  let escaped = false

  const add = (text, startLine) => comments.push({ text, line: startLine })

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '\n') {
      line += 1
      escaped = false
      index += 1
      continue
    }

    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      index += 1
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      index += 1
      continue
    }

    if (char === '/' && next === '/') {
      const start = index + 2
      const end = source.indexOf('\n', start)
      add(source.slice(start, end < 0 ? source.length : end), line)
      index = end < 0 ? source.length : end
      continue
    }

    if (char === '/' && next === '*') {
      const startLine = line
      const start = index + 2
      const end = source.indexOf('*/', start)
      const stop = end < 0 ? source.length : end
      const text = source.slice(start, stop)
      add(text, startLine)
      line += (text.match(/\n/g) || []).length
      index = end < 0 ? source.length : end + 2
      continue
    }

    if (char === '<' && source.startsWith('<!--', index)) {
      const startLine = line
      const start = index + 4
      const end = source.indexOf('-->', start)
      const stop = end < 0 ? source.length : end
      const text = source.slice(start, stop)
      add(text, startLine)
      line += (text.match(/\n/g) || []).length
      index = end < 0 ? source.length : end + 3
      continue
    }

    index += 1
  }

  return comments
}

const violations = []
const reports = []
for (const root of ROOTS) {
  for (const file of collectFiles(path.resolve(root))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const comment of extractComments(source)) {
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/')
      for (const rule of FORBIDDEN) {
        const match = comment.text.match(rule.pattern)
        if (!match) continue
        const offset = comment.text.slice(0, match.index).split('\n').length - 1
        const excerpt = comment.text.split('\n')[offset]?.trim().replace(/^\*\s?/, '') || match[0]
        violations.push(`${relative}:${comment.line + offset} [${rule.name}] ${excerpt}`)
      }
      for (const rule of REPORT_ONLY) {
        const match = comment.text.match(rule.pattern)
        if (!match) continue
        const offset = comment.text.slice(0, match.index).split('\n').length - 1
        const excerpt = comment.text.split('\n')[offset]?.trim().replace(/^\*\s?/, '') || match[0]
        reports.push(`${relative}:${comment.line + offset} [${rule.name}] ${excerpt}`)
      }
    }
  }
}

if (reports.length) {
  console.warn(`发现 ${reports.length} 条建议人工复核的源码注释（不阻断）：`)
  for (const report of reports) console.warn(report)
}

if (violations.length) {
  console.error(`发现 ${violations.length} 条不合规源码注释：`)
  for (const violation of violations) console.error(violation)
  process.exitCode = 1
} else {
  console.log('源码注释检查通过')
}
