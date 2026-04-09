import path from 'node:path'
import { getGlobalRoot } from '../core/instance/instance-context.js'
import { InstanceRegistry } from '../core/instance/instance-registry.js'

/**
 * Resolve the stable instance ID for a given instance root.
 * Falls back to the parent directory name if not found in registry.
 */
export function resolveInstanceId(instanceRoot: string): string {
  try {
    const reg = new InstanceRegistry(path.join(getGlobalRoot(), 'instances.json'))
    reg.load()
    const entry = reg.getByRoot(instanceRoot)
    if (entry?.id) return entry.id
  } catch { /* ignore */ }
  // Fallback: sanitized parent dir name (e.g. /home/user/my-project/.openacp → my-project)
  return path.basename(path.dirname(instanceRoot)).replace(/[^a-zA-Z0-9-]/g, '-') || 'default'
}
