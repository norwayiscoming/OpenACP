#!/usr/bin/env node

import { setDefaultAutoSelectFamily } from "node:net";
setDefaultAutoSelectFamily(false);

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
import { resolveInstanceRoot } from './core/instance-context.js'

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

const commands: Record<string, () => Promise<void>> = {
  '--help': async () => printHelp(),
  '-h': async () => printHelp(),
  '--version': () => cmdVersion(),
  '-v': () => cmdVersion(),
  'install': () => cmdInstall(args),
  'uninstall': () => cmdUninstall(args),
  'plugins': () => cmdPlugins(args),
  'plugin': () => cmdPlugin(args),
  'api': () => cmdApi(args),
  'start': () => cmdStart(args),
  'stop': () => cmdStop(args),
  'status': () => cmdStatus(args),
  'logs': () => cmdLogs(args),
  'config': () => cmdConfig(args),
  'reset': () => cmdReset(args),
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
    await startServer()
  },
}

async function main() {
  const handler = command ? commands[command] : undefined
  if (handler) {
    await handler()
  } else {
    await cmdDefault(command)
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
