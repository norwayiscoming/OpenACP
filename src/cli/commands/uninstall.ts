import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PLUGINS_DIR } from '../../core/config/config.js'
import { wantsHelp } from './helpers.js'

export async function cmdUninstall(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp uninstall\x1b[0m — Remove a plugin adapter

\x1b[1mUsage:\x1b[0m
  openacp uninstall <package>

\x1b[1mArguments:\x1b[0m
  <package>       npm package name to remove

\x1b[1mExamples:\x1b[0m
  openacp uninstall @openacp/adapter-discord
`)
    return
  }
  const pkg = args[1]
  if (!pkg) {
    console.error("Usage: openacp uninstall <package>")
    process.exit(1)
  }
  fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  const pkgPath = path.join(PLUGINS_DIR, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'openacp-plugins', private: true, dependencies: {} }, null, 2))
  }
  console.log(`Uninstalling ${pkg}...`)
  execSync(`npm uninstall ${pkg} --prefix "${PLUGINS_DIR}"`, { stdio: 'inherit' })
  console.log(`Plugin ${pkg} uninstalled.`)
}
