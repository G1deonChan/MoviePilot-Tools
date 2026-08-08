import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const coreDir = path.resolve('core')
const sourceExtensions = new Set(['.ts', '.js', '.mjs'])
const serviceImport = /(?:from\s+|import\s*\()["'](?:\.\.\/|@\/|~\/)services\//u
const violations = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else if (sourceExtensions.has(path.extname(entry.name))) {
      const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/u)
      lines.forEach((line, index) => {
        if (!serviceImport.test(line)) return
        violations.push(`${path.relative(process.cwd(), absolute).replaceAll('\\', '/')}:${index + 1} ${line.trim()}`)
      })
    }
  }
}

walk(coreDir)

if (violations.length) {
  console.error('core 不得导入 services：')
  violations.forEach((violation) => console.error(violation))
  process.exitCode = 1
} else {
  console.log('依赖方向检查通过')
}
