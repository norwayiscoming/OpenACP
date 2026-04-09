import * as path from 'node:path';
import { randomUUID } from 'node:crypto'
import { jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { getGlobalRoot } from '../../core/instance/instance-context.js'
import { InstanceRegistry } from '../../core/instance/instance-registry.js'
import { initInstanceFiles } from '../../core/instance/instance-init.js'

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

export async function cmdSetup(args: string[], instanceRoot: string): Promise<void> {
  const agentRaw = parseFlag(args, '--agent');
  const json = args.includes('--json');
  if (json) await muteForJson()

  if (!agentRaw) {
    if (json) jsonError(ErrorCodes.MISSING_ARGUMENT, '--agent is required')
    console.error('  Error: --agent <name> is required');
    process.exit(1);
  }

  const rawRunMode = parseFlag(args, '--run-mode') ?? 'daemon';
  if (rawRunMode !== 'daemon' && rawRunMode !== 'foreground') {
    if (json) jsonError(ErrorCodes.CONFIG_INVALID, `--run-mode must be 'daemon' or 'foreground'`)
    console.error(`  Error: --run-mode must be 'daemon' or 'foreground'`);
    process.exit(1);
  }
  const runMode = rawRunMode as 'daemon' | 'foreground';

  const agents = agentRaw.split(',').map(a => a.trim());

  // Write config.json (merged), agents.json, and plugins.json via shared init logic
  initInstanceFiles(instanceRoot, { agents, runMode, mergeExisting: true })

  // Register this instance in the global registry if not already present.
  // This ensures `openacp instances list` and the interactive instance picker
  // can discover instances created via `openacp setup` directly.
  const registryPath = path.join(getGlobalRoot(), 'instances.json')
  const registry = new InstanceRegistry(registryPath)
  registry.load()
  if (!registry.getByRoot(instanceRoot)) {
    registry.register(randomUUID(), instanceRoot)
    registry.save()
  }

  const configPath = path.join(instanceRoot, 'config.json');
  if (json) {
    jsonSuccess({ configPath });
  } else {
    console.log(`\n  \x1b[32m✓ Setup complete.\x1b[0m Config written to ${configPath}\n`);
  }
}
