import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { wantsHelp } from './helpers.js'

export async function cmdUninstall(args: string[], instanceRoot?: string): Promise<void> {
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  const pluginsDir = path.join(root, 'plugins')
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
  const pkg = args[0]
  if (!pkg) {
    console.error("Usage: openacp uninstall <package>")
    process.exit(1)
  }
  fs.mkdirSync(pluginsDir, { recursive: true })
  const pkgPath = path.join(pluginsDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'openacp-plugins', private: true, dependencies: {} }, null, 2))
  }
  console.log(`Uninstalling ${pkg}...`)
  execSync(`npm uninstall ${pkg} --prefix "${pluginsDir}"`, { stdio: 'inherit' })
  console.log(`Plugin ${pkg} uninstalled.`)
}
