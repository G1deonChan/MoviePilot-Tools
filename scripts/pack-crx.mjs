/**
 * 将 .output/chrome-mv3 打成 Chrome CRX
 *
 * 用法:
 *   node scripts/pack-crx.mjs              # 需已有构建产物
 *   node scripts/pack-crx.mjs --build      # 先 wxt build 再打包
 *   npm run pack:crx
 *   npm run build:crx
 *
 * 私钥: 优先 CRX_PRIVATE_KEY_2_0 环境变量（PEM 内容，CI 由 secret 注入）；
 *       否则 keys/extension.pem（首次自动生成，请妥善保管以保持扩展 ID 稳定）
 * 输出: release/MoviePilot-tools-<version>.crx
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.0.0')

const extDir = path.join(root, '.output', 'chrome-mv3')
const keysDir = path.join(root, 'keys')
const keyPath = path.join(keysDir, 'extension.pem')
const releaseDir = path.join(root, 'release')
const outCrx = path.join(releaseDir, `MoviePilot-tools-${version}.crx`)

const wantBuild = process.argv.includes('--build')

function log(msg) {
  console.log(`[pack:crx] ${msg}`)
}

function fail(msg, code = 1) {
  console.error(`[pack:crx] ${msg}`)
  process.exit(code)
}

function findChrome() {
  const env = process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN
  if (env && fs.existsSync(env)) return env

  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  })
  return r.status ?? 1
}

function main() {
  if (wantBuild) {
    log('building chrome-mv3 …')
    const code = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wxt', 'build'], {
      cwd: root,
      shell: process.platform === 'win32',
    })
    if (code !== 0) fail(`wxt build failed (exit ${code})`)
  }

  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
    fail(`未找到构建产物: ${path.relative(root, extDir)}\n  请先执行: npm run build\n  或: npm run build:crx`)
  }

  const chrome = findChrome()
  if (!chrome) {
    fail(
      '未找到 Chrome。请安装 Google Chrome，或设置环境变量 CHROME_PATH 指向 chrome.exe',
    )
  }
  log(`chrome: ${chrome}`)
  log(`extension: ${path.relative(root, extDir)}`)

  fs.mkdirSync(keysDir, { recursive: true })
  fs.mkdirSync(releaseDir, { recursive: true })

  // 优先使用 CRX_PRIVATE_KEY_2_0 环境变量（CI 中由 secret 注入 PEM 内容），否则回退到 keys/extension.pem
  const envKey = process.env.CRX_PRIVATE_KEY_2_0
  if (envKey && envKey.trim()) {
    fs.writeFileSync(keyPath, envKey.trim() + '\n')
    log('key: CRX_PRIVATE_KEY_2_0 (env) → keys/extension.pem')
  }

  const hasKey = fs.existsSync(keyPath)
  const args = [`--pack-extension=${extDir}`]
  if (hasKey) {
    args.push(`--pack-extension-key=${keyPath}`)
    log(`key: ${path.relative(root, keyPath)} (reuse)`)
  } else {
    log('key: (none) — Chrome 将生成新私钥')
  }

  // Chrome pack 不依赖已打开的浏览器；失败时看 stderr
  const status = run(chrome, args)
  if (status !== 0) {
    fail(
      `Chrome 打包失败 (exit ${status})。可尝试关闭多余 Chrome 进程后重试，或手动：\n` +
        `  chrome.exe --pack-extension="${extDir}"` +
        (hasKey ? ` --pack-extension-key="${keyPath}"` : ''),
    )
  }

  // Chrome 默认在扩展目录旁输出：.output/chrome-mv3.crx / .output/chrome-mv3.pem
  const producedCrx = path.join(root, '.output', 'chrome-mv3.crx')
  const producedPem = path.join(root, '.output', 'chrome-mv3.pem')

  if (!fs.existsSync(producedCrx)) {
    fail(`未找到输出 CRX: ${producedCrx}`)
  }

  // 首次生成的 pem 挪到 keys/，后续复用保持扩展 ID
  if (!hasKey && fs.existsSync(producedPem)) {
    fs.renameSync(producedPem, keyPath)
    log(`saved key → ${path.relative(root, keyPath)}`)
  } else if (fs.existsSync(producedPem) && hasKey) {
    // 复用既有私钥时删除 Chrome 额外生成的临时 PEM。
    try {
      fs.unlinkSync(producedPem)
    } catch {
      /* 临时 PEM 清理失败不影响既有私钥和 CRX 产物。 */
    }
  }

  fs.copyFileSync(producedCrx, outCrx)
  try {
    fs.unlinkSync(producedCrx)
  } catch {
    /* 源 CRX 清理失败不影响已复制到 `release/` 的发布产物。 */
  }

  const size = fs.statSync(outCrx).size
  log(`done → ${path.relative(root, outCrx)} (${(size / 1024 / 1024).toFixed(2)} MB)`)
  if (!hasKey) {
    log('提示: 请备份 keys/extension.pem，更新版本时用同一私钥才能保持扩展 ID 不变')
  }
}

main()
