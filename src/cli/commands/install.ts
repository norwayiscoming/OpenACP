import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { wantsHelp } from './helpers.js'

export async function cmdInstall(args: string[], instanceRoot?: string): Promise<void> {
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')
  const pluginsDir = path.join(root, 'plugins')
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp install\x1b[0m — Install a plugin adapter

\x1b[1mUsage:\x1b[0m
  openacp install <package>

\x1b[1mArguments:\x1b[0m
  <package>       npm package name (e.g. @openacp/adapter-discord)

Installs the plugin to ~/.openacp/plugins/.

\x1b[1mExamples:\x1b[0m
  openacp install @openacp/adapter-discord
`)
    return
  }
  const pkg = args[0]
  if (!pkg) {
    console.error("Usage: openacp install <package>")
    process.exit(1)
  }
  fs.mkdirSync(pluginsDir, { recursive: true })
  const pkgPath = path.join(pluginsDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'openacp-plugins', private: true, dependencies: {} }, null, 2))
  }
  console.log(`Installing ${pkg}...`)
  execSync(`npm install ${pkg} --prefix "${pluginsDir}"`, { stdio: 'inherit' })
  console.log(`Plugin ${pkg} installed successfully.`)
}
