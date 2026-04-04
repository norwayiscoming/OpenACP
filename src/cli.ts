#!/usr/bin/env node

import { setDefaultAutoSelectFamily } from "node:net";
setDefaultAutoSelectFamily(false);

import path from 'node:path'
import {
  printHelp,
  cmdVersion,
  cmdInstall,
  cmdUninstall,
  cmdPlugins,
  cmdPlugin,
  cmdApi,
  cmdStart,
  cmdStop,
  cmdRestart,
  cmdStatus,
  cmdLogs,
  cmdConfig,
  cmdReset,
  cmdUpdate,
  cmdDefault,
  cmdAdopt,
  cmdInstances,
  cmdIntegrate,
  cmdDoctor,
  cmdAgents,
  cmdTunnel,
  cmdOnboard,
  cmdDev,
  cmdAttach,
  cmdRemote,
  cmdSetup,
} from './cli/commands/index.js'
import { resolveInstanceRoot } from './core/instance/instance-context.js'

export interface InstanceFlags {
  local: boolean
  global: boolean
  dir?: string
  from?: string
  name?: string
}

function extractInstanceFlags(args: string[]): { flags: InstanceFlags; remaining: string[] } {
  const flags: InstanceFlags = { local: false, global: false }
  const remaining: string[] = []
  let i = 0
  while (i < args.length) {
    if (args[i] === '--local') { flags.local = true; i++ }
    else if (args[i] === '--global') { flags.global = true; i++ }
    else if (args[i] === '--dir' && args[i + 1]) { flags.dir = args[i + 1]; i += 2 }
    else if (args[i] === '--from' && args[i + 1]) { flags.from = args[i + 1]; i += 2 }
    else if (args[i] === '--name' && args[i + 1]) { flags.name = args[i + 1]; i += 2 }
    else { remaining.push(args[i]!); i++ }
  }
  return { flags, remaining }
}

let resolvedInstanceRoot: string | null = null
let instanceFlags: InstanceFlags = { local: false, global: false }

export function getResolvedInstanceRoot(): string | null {
  return resolvedInstanceRoot
}

export function getInstanceFlags(): InstanceFlags {
  return instanceFlags
}

const allArgs = process.argv.slice(2)
const { flags, remaining } = extractInstanceFlags(allArgs)
instanceFlags = flags
const [command, ...args] = remaining

// Resolve instance root from flags
resolvedInstanceRoot = resolveInstanceRoot({
  dir: flags.dir,
  local: flags.local,
  global: flags.global,
  cwd: process.cwd(),
})

// Commands that don't need an instance root
const noInstanceCommands: Record<string, () => Promise<void>> = {
  '--help': async () => printHelp(),
  '-h': async () => printHelp(),
  '--version': () => cmdVersion(args),
  '-v': () => cmdVersion(args),
  'update': () => cmdUpdate(args),
  'adopt': () => cmdAdopt(args),
  'instances': async () => cmdInstances(args),
  'integrate': () => cmdIntegrate(args),
  'dev': () => cmdDev(args),
}

/**
 * Resolve instance root, prompting interactively when needed.
 * - If flags or auto-detect resolved it → use that
 * - If null + operational command → prompt with existing instances only
 * - If null + cmdDefault → prompt with existing + "create new here"
 */
async function resolveRoot(allowCreate: boolean): Promise<string> {
  if (resolvedInstanceRoot) return resolvedInstanceRoot
  const { promptForInstance } = await import('./cli/instance-prompt.js')
  return promptForInstance({ allowCreate })
}

async function main() {
  // No-instance commands
  const noInstance = command ? noInstanceCommands[command] : undefined
  if (noInstance) {
    await noInstance()
    return
  }

  // Daemon child (special: reads root from env)
  if (command === '--daemon-child') {
    const { startServer } = await import('./main.js')
    const envRoot = process.env.OPENACP_INSTANCE_ROOT
    if (envRoot) {
      const { createInstanceContext, getGlobalRoot: getGlobal } = await import('./core/instance/instance-context.js')
      const { InstanceRegistry } = await import('./core/instance/instance-registry.js')
      const registry = new InstanceRegistry(path.join(getGlobal(), 'instances.json'))
      await registry.load()
      const entry = registry.getByRoot(envRoot)
      const { randomUUID } = await import('node:crypto')
      const id = entry?.id ?? randomUUID()
      const ctx = createInstanceContext({
        id,
        root: envRoot,
        isGlobal: envRoot === getGlobal(),
      })
      await startServer({ instanceContext: ctx })
    } else {
      await startServer()
    }
    return
  }

  // Instance-aware commands (resolve root with prompt if needed)
  const instanceCommands: Record<string, (root: string) => Promise<void>> = {
    'install': (r) => cmdInstall(args, r),
    'uninstall': (r) => cmdUninstall(args, r),
    'plugins': (r) => cmdPlugins(args, r),
    'plugin': (r) => cmdPlugin(args, r),
    'api': (r) => cmdApi(args, r),
    'start': (r) => cmdStart(args, r),
    'stop': (r) => cmdStop(args, r),
    'restart': (r) => cmdRestart(args, r),
    'status': (r) => cmdStatus(args, r),
    'logs': (r) => cmdLogs(args, r),
    'config': (r) => cmdConfig(args, r),
    'reset': (r) => cmdReset(args, r),
    'doctor': (r) => cmdDoctor(args, r),
    'agents': (r) => cmdAgents(args, r),
    'tunnel': (r) => cmdTunnel(args, r),
    'onboard': (r) => cmdOnboard(r),
    'attach': (r) => cmdAttach(args, r),
    'remote': (r) => cmdRemote(args, r),
    'setup': (r) => cmdSetup(args, r),
  }

  const handler = command ? instanceCommands[command] : undefined
  if (handler) {
    const root = await resolveRoot(false)
    await handler(root)
  } else {
    // cmdDefault: allow "create new here" option
    const root = await resolveRoot(true)
    await cmdDefault(command, root)
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
