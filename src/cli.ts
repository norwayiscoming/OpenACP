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
  cmdIntegrate,
  cmdDoctor,
  cmdAgents,
  cmdTunnel,
  cmdOnboard,
  cmdDev,
} from './cli/commands/index.js'
import { resolveInstanceRoot, getGlobalRoot } from './core/instance-context.js'

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

const root = resolvedInstanceRoot ?? getGlobalRoot()

const commands: Record<string, () => Promise<void>> = {
  '--help': async () => printHelp(),
  '-h': async () => printHelp(),
  '--version': () => cmdVersion(),
  '-v': () => cmdVersion(),
  'install': () => cmdInstall(args, root),
  'uninstall': () => cmdUninstall(args, root),
  'plugins': () => cmdPlugins(args, root),
  'plugin': () => cmdPlugin(args, root),
  'api': () => cmdApi(args),
  'start': () => cmdStart(args, root),
  'stop': () => cmdStop(args, root),
  'restart': () => cmdRestart(args, root),
  'status': () => cmdStatus(args),
  'logs': () => cmdLogs(args),
  'config': () => cmdConfig(args),
  'reset': () => cmdReset(args, root),
  'update': () => cmdUpdate(args),
  'adopt': () => cmdAdopt(args),
  'integrate': () => cmdIntegrate(args),
  'doctor': () => cmdDoctor(args),
  'agents': () => cmdAgents(args),
  'tunnel': () => cmdTunnel(args),
  'onboard': () => cmdOnboard(),
  'dev': () => cmdDev(args),
  '--daemon-child': async () => {
    const { startServer } = await import('./main.js')
    const envRoot = process.env.OPENACP_INSTANCE_ROOT
    if (envRoot) {
      const { createInstanceContext, getGlobalRoot: getGlobal } = await import('./core/instance-context.js')
      const { InstanceRegistry } = await import('./core/instance-registry.js')
      const registry = new InstanceRegistry(path.join(getGlobal(), 'instances.json'))
      await registry.load()
      const entry = registry.getByRoot(envRoot)
      const id = entry?.id ?? 'unknown'
      const ctx = createInstanceContext({
        id,
        root: envRoot,
        isGlobal: envRoot === getGlobal(),
      })
      await startServer({ instanceContext: ctx })
    } else {
      await startServer()
    }
  },
}

async function main() {
  const handler = command ? commands[command] : undefined
  if (handler) {
    await handler()
  } else {
    await cmdDefault(command, root)
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
