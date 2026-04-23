import fs from 'fs/promises'
import path from 'path'
import { loadEnvLocal } from './load-env-local.mjs'

const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'browser-extension')
const OUT_ROOT = path.join(ROOT, 'extension-build')

const TARGETS = {
  chrome: 'manifest.chrome.json',
  firefox: 'manifest.firefox.json',
}

const MANIFEST_FILES = new Set([
  'manifest.json',
  'manifest.chrome.json',
  'manifest.firefox.json',
])

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function copyDirRecursive(srcDir, dstDir) {
  await fs.mkdir(dstDir, { recursive: true })
  const entries = await fs.readdir(srcDir, { withFileTypes: true })

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue

    const srcPath = path.join(srcDir, ent.name)
    const dstPath = path.join(dstDir, ent.name)

    if (ent.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath)
      continue
    }

    if (!ent.isFile()) continue
    if (MANIFEST_FILES.has(ent.name)) continue

    await fs.copyFile(srcPath, dstPath)
  }
}

async function injectEnvDefaults(targetDir) {
  const mapillaryToken = String(process.env.NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN || '').trim()
  if (!mapillaryToken) return

  const popupPath = path.join(targetDir, 'popup.js')
  const bridgePath = path.join(targetDir, 'content-bridge.js')

  const patchPopup = async () => {
    try {
      const text = await fs.readFile(popupPath, 'utf8')
      const needle = "mapillaryClientToken: ''"
      if (!text.includes(needle)) return
      const safe = mapillaryToken.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      await fs.writeFile(popupPath, text.replace(needle, `mapillaryClientToken: '${safe}'`), 'utf8')
    } catch {
      /* ignore */
    }
  }

  const patchBridge = async () => {
    try {
      const text = await fs.readFile(bridgePath, 'utf8')
      const needle = 'const items = await chrome.storage.sync.get({ mapillaryClientToken: "" });'
      if (!text.includes(needle)) return
      const safe = mapillaryToken.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      await fs.writeFile(
        bridgePath,
        text.replace(
          needle,
          `const items = await chrome.storage.sync.get({ mapillaryClientToken: "${safe}" });`
        ),
        'utf8'
      )
    } catch {
      /* ignore */
    }
  }

  await Promise.all([patchPopup(), patchBridge()])
}

async function buildTarget(target) {
  const manifestTemplate = TARGETS[target]
  if (!manifestTemplate) {
    throw new Error(`Unknown target: ${target}`)
  }

  const targetDir = path.join(OUT_ROOT, target)
  const manifestTemplatePath = path.join(SOURCE_DIR, manifestTemplate)
  const manifestOutPath = path.join(targetDir, 'manifest.json')

  if (!(await pathExists(manifestTemplatePath))) {
    throw new Error(`Missing manifest template: ${manifestTemplatePath}`)
  }

  await fs.rm(targetDir, { recursive: true, force: true })
  await copyDirRecursive(SOURCE_DIR, targetDir)
  await injectEnvDefaults(targetDir)
  await fs.copyFile(manifestTemplatePath, manifestOutPath)

  console.log(`Built ${target}: ${path.relative(ROOT, targetDir)}`)
}

async function main() {
  loadEnvLocal()
  const arg = process.argv[2] || 'all'

  if (!(await pathExists(SOURCE_DIR))) {
    throw new Error(`Missing source directory: ${SOURCE_DIR}`)
  }

  await fs.mkdir(OUT_ROOT, { recursive: true })

  if (arg === 'all') {
    await buildTarget('chrome')
    await buildTarget('firefox')
    return
  }

  if (arg !== 'chrome' && arg !== 'firefox') {
    throw new Error(`Usage: node scripts/build-extension-targets.mjs [all|chrome|firefox]`)
  }

  await buildTarget(arg)
}

main().catch((err) => {
  console.error('[build-extension-targets]', err.message)
  process.exit(1)
})
