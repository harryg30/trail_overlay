import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import JSZip from 'jszip'

const EXTENSION_DIR = path.resolve(process.cwd(), 'browser-extension')
const BUILD_DIR = path.resolve(process.cwd(), 'extension-build')
const RELEASES_DIR = path.resolve(process.cwd(), 'extension-releases')
const RELEASES_INDEX = path.join(RELEASES_DIR, 'releases.json')

function sanitizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function collectFiles(rootResolved) {
  const out = []

  async function walk(relDir) {
    const absDir = path.join(rootResolved, relDir)
    const entries = (await fs.readdir(absDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const relEntry = relDir ? `${relDir}/${ent.name}` : ent.name
      const absEntry = path.join(rootResolved, relEntry)

      if (ent.isDirectory()) {
        await walk(relEntry)
      } else if (ent.isFile()) {
        const data = await fs.readFile(absEntry)
        out.push({ rel: relEntry.replace(/\\/g, '/'), data })
      }
    }
  }

  await walk('')
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return out
}

async function readReleaseIndex() {
  try {
    const raw = await fs.readFile(RELEASES_INDEX, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.releases)) return parsed
    return { latest: null, releases: [] }
  } catch {
    return { latest: null, releases: [] }
  }
}


async function buildTargets() {
  const buildScript = path.join(process.cwd(), 'scripts/build-extension-targets.mjs')
  try {
    execSync(`node ${buildScript}`, { stdio: 'inherit' })
  } catch (err) {
    throw new Error(`Failed to build extension targets: ${err.message}`)
  }
}

async function releaseTarget(target, versionDir, extensionName, version) {
  const sourceDir = path.join(BUILD_DIR, target)
  const manifestPath = path.join(sourceDir, 'manifest.json')

  const manifestStat = await fs.stat(manifestPath).catch(() => null)
  if (!manifestStat?.isFile()) {
    throw new Error(`Missing manifest in built ${target} extension: ${manifestPath}`)
  }

  const zipFileName = `${extensionName}-${target}-v${version}.zip`
  const zipPath = path.join(versionDir, zipFileName)

  const files = await collectFiles(sourceDir)
  if (files.length === 0) {
    throw new Error(`No files found in extension-build/${target}/`)
  }

  const zip = new JSZip()
  for (const { rel, data } of files) {
    zip.file(rel, data)
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })

  await fs.writeFile(zipPath, buffer)

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const stats = await fs.stat(zipPath)

  const entry = {
    version,
    target,
    file: path.relative(RELEASES_DIR, zipPath).replace(/\\/g, '/'),
    sizeBytes: stats.size,
    sha256,
    createdAt: new Date().toISOString(),
  }

  const latestFile = path.join(RELEASES_DIR, `latest-${target}.zip`)
  await fs.copyFile(zipPath, latestFile)

  console.log(`Created ${path.relative(process.cwd(), zipPath)}`)
  console.log(`Updated ${path.relative(process.cwd(), latestFile)}`)

  return entry
}

async function main() {
  const manifestPath = path.join(EXTENSION_DIR, 'manifest.json')
  const manifestRaw = await fs.readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestRaw)

  const version = String(manifest.version || '').trim()
  if (!version) {
    throw new Error('manifest.json is missing a version field')
  }

  const extensionName = sanitizeName(manifest.name || 'trail-overlay-strava-extension')
  const versionDir = path.join(RELEASES_DIR, `v${version}`)

  console.log('Building extension targets...')
  await buildTargets()

  await fs.mkdir(versionDir, { recursive: true })

  const chromeEntry = await releaseTarget('chrome', versionDir, extensionName, version)
  const firefoxEntry = await releaseTarget('firefox', versionDir, extensionName, version)

  const currentIndex = await readReleaseIndex()
  const nextIndex = {
    latest: {
      chrome: chromeEntry,
      firefox: firefoxEntry,
      version,
      createdAt: new Date().toISOString(),
    },
    releases: [
      ...currentIndex.releases.filter(r => r.version !== version),
      { version, targets: { chrome: chromeEntry, firefox: firefoxEntry }, createdAt: new Date().toISOString() },
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  }

  await fs.writeFile(RELEASES_INDEX, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8')
  console.log(`Updated ${path.relative(process.cwd(), RELEASES_INDEX)}`)
  console.log(`✓ Release v${version} complete (Chrome MV3 + Firefox MV2)`)
}

main().catch(err => {
  console.error('[release-extension]', err.message)
  process.exit(1)
})
