import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { createChildLogger } from './log.js'
import { commandExists } from './agent-dependencies.js'

const log = createChildLogger({ module: 'binary-installer' })

const BIN_DIR = path.join(os.homedir(), '.openacp', 'bin')
const IS_WINDOWS = os.platform() === 'win32'

export interface BinarySpec {
  name: string
  /** GitHub base URL for releases, e.g. "https://github.com/jqlang/jq/releases/latest/download" */
  githubBaseUrl: string
  /** Platform → arch → filename mapping */
  platforms: Record<string, Record<string, string>>
  /** If true, downloaded file is a .tgz archive that needs extraction */
  isArchive?: (url: string) => boolean
}

function downloadFile(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)

    const cleanup = () => {
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest) } catch { /* ignore */ }
    }

    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close(() => {
          cleanup()
          downloadFile(response.headers.location!, dest).then(resolve).catch(reject)
        })
        return
      }

      if (response.statusCode !== 200) {
        file.close(() => {
          cleanup()
          reject(new Error(`Download failed with status ${response.statusCode}`))
        })
        return
      }

      response.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
      file.on('error', (err) => {
        file.close(() => {
          cleanup()
          reject(err)
        })
      })
    }).on('error', (err) => {
      file.close(() => {
        cleanup()
        reject(err)
      })
    })
  })
}

function getDownloadUrl(spec: BinarySpec): string {
  const platform = os.platform()
  const arch = os.arch()
  const mapping = spec.platforms[platform]
  if (!mapping) throw new Error(`${spec.name}: unsupported platform ${platform}`)
  const binary = mapping[arch]
  if (!binary) throw new Error(`${spec.name}: unsupported architecture ${arch} for ${platform}`)
  return `${spec.githubBaseUrl}/${binary}`
}

/**
 * Ensure a binary is available.
 * 1. Check PATH first (respects user's system install)
 * 2. Check ~/.openacp/bin/
 * 3. Download from GitHub releases
 */
export async function ensureBinary(spec: BinarySpec): Promise<string> {
  const binName = IS_WINDOWS ? `${spec.name}.exe` : spec.name
  const binPath = path.join(BIN_DIR, binName)

  // 1. Check PATH first
  if (commandExists(spec.name)) {
    log.debug({ name: spec.name }, 'Found in PATH')
    return spec.name
  }

  // 2. Check our bin directory
  if (fs.existsSync(binPath)) {
    if (!IS_WINDOWS) fs.chmodSync(binPath, '755')
    log.debug({ name: spec.name, path: binPath }, 'Found in ~/.openacp/bin')
    return binPath
  }

  // 3. Download
  log.info({ name: spec.name }, 'Not found, downloading from GitHub...')
  fs.mkdirSync(BIN_DIR, { recursive: true })

  const url = getDownloadUrl(spec)
  const isArchive = spec.isArchive?.(url) ?? false
  const downloadDest = isArchive ? path.join(BIN_DIR, `${spec.name}.tgz`) : binPath

  await downloadFile(url, downloadDest)

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: 'pipe' })
    try { fs.unlinkSync(downloadDest) } catch { /* ignore */ }
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(binPath, '755')
  }

  log.info({ name: spec.name, path: binPath }, 'Installed successfully')
  return binPath
}
