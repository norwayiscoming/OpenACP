import os from 'node:os'

/**
 * Print which instance root is being used.
 */
export function printInstanceHint(root: string): void {
  const displayPath = root.replace(os.homedir(), '~')
  console.log(`  Workspace: ${displayPath}`)
}
