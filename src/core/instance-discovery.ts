import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiscoveredInstance {
  id: string;
  root: string;
  name: string;
  port: number;
  running: boolean;
}

export async function discoverRunningInstances(registryPath: string): Promise<DiscoveredInstance[]> {
  let registry: { version: number; instances: Record<string, { id: string; root: string }> };
  try {
    const data = await readFile(registryPath, 'utf-8');
    registry = JSON.parse(data);
  } catch {
    return [];
  }

  const discovered: DiscoveredInstance[] = [];

  for (const entry of Object.values(registry.instances)) {
    try {
      const portStr = await readFile(join(entry.root, 'api.port'), 'utf-8');
      const port = parseInt(portStr.trim(), 10);
      if (isNaN(port)) continue;

      const isHealthy = await checkHealth(port);
      if (!isHealthy) continue;

      let name = entry.id;
      try {
        const configData = await readFile(join(entry.root, 'config.json'), 'utf-8');
        const config = JSON.parse(configData);
        if (config.instanceName) name = config.instanceName;
      } catch {
        // config not readable, use id as name
      }

      discovered.push({ id: entry.id, root: entry.root, name, port, running: true });
    } catch {
      continue;
    }
  }

  return discovered;
}

async function checkHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/system/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
