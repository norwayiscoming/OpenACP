import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const execAsync = promisify(exec)

/**
 * Import a package resolved from a specific directory (not the project root).
 * Reads the package's package.json to find the ESM entry point, then imports by file path.
 */
export async function importFromDir(packageName: string, dir: string): Promise<any> {
  const pkgDir = path.join(dir, 'node_modules', ...packageName.split('/'))
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))

  // Resolve entry: exports["."].import > main > index.js
  let entry: string
  const exportsMain = pkgJson.exports?.['.']
  if (typeof exportsMain === 'string') {
    entry = exportsMain
  } else if (exportsMain?.import) {
    entry = exportsMain.import
  } else {
    entry = pkgJson.main ?? 'index.js'
  }

  const entryPath = path.join(pkgDir, entry)
  return import(pathToFileURL(entryPath).href)
}

/**
 * Install an npm package to the plugins directory and return the loaded module.
 * Tries to import first; if not installed, runs npm install asynchronously.
 */
export async function installNpmPlugin(packageName: string, pluginsDir?: string): Promise<any> {
  const dir = pluginsDir ?? path.join(os.homedir(), '.openacp', 'plugins')

  // Try import from plugins dir first — already installed
  try {
    return await importFromDir(packageName, dir)
  } catch {
    // Not installed, proceed with install
  }

  await execAsync(`npm install ${packageName} --prefix "${dir}" --save`, {
    timeout: 60000,
  })

  return await importFromDir(packageName, dir)
}
