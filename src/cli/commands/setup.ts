import * as fs from 'node:fs';
import * as path from 'node:path';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

export async function cmdSetup(args: string[], instanceRoot: string): Promise<void> {
  const workspace = parseFlag(args, '--workspace');
  const agentRaw = parseFlag(args, '--agent');
  const json = args.includes('--json');

  if (!workspace) {
    if (json) {
      console.log(JSON.stringify({ success: false, error: '--workspace is required' }));
    } else {
      console.error('  Error: --workspace <path> is required');
    }
    process.exit(1);
  }

  if (!agentRaw) {
    if (json) {
      console.log(JSON.stringify({ success: false, error: '--agent is required' }));
    } else {
      console.error('  Error: --agent <name> is required');
    }
    process.exit(1);
  }

  const rawRunMode = parseFlag(args, '--run-mode') ?? 'daemon';
  if (rawRunMode !== 'daemon' && rawRunMode !== 'foreground') {
    if (json) {
      console.log(JSON.stringify({ success: false, error: `--run-mode must be 'daemon' or 'foreground'` }));
    } else {
      console.error(`  Error: --run-mode must be 'daemon' or 'foreground'`);
    }
    process.exit(1);
  }
  const runMode = rawRunMode as 'daemon' | 'foreground';

  const defaultAgent = agentRaw.split(',')[0]!.trim();

  const configPath = path.join(instanceRoot, 'config.json');

  // Read existing config if present so we don't overwrite unrelated fields
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // Ignore parse errors — overwrite with fresh config
    }
  }

  const config = {
    ...existing,
    defaultAgent,
    workspace: { baseDir: workspace },
    runMode,
    autoStart: false,
  };

  fs.mkdirSync(instanceRoot, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  if (json) {
    console.log(JSON.stringify({ success: true, configPath }));
  } else {
    console.log(`\n  \x1b[32m✓ Setup complete.\x1b[0m Config written to ${configPath}\n`);
  }
}
