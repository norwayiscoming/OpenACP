import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getGlobalRoot } from '../core/instance/instance-context.js'

/**
 * Print which instance root is being used.
 * If a local .openacp exists in cwd but global is active, show a hint.
 */
export function printInstanceHint(root: string): void {
  const globalRoot = getGlobalRoot()
  const isGlobal = root === globalRoot
  const displayPath = root.replace(os.homedir(), '~')
  const label = isGlobal ? 'global' : 'local'

  console.log(`  Workspace: ${label} — ${displayPath}`)

  // If using global but local exists in cwd, hint
  if (isGlobal) {
    const localRoot = path.join(process.cwd(), '.openacp')
    if (fs.existsSync(localRoot)) {
      console.log(`  \x1b[2mhint: local workspace exists in current directory — use --local to use it\x1b[0m`)
    }
  }
}
