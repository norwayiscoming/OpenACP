import type { FastifyInstance } from 'fastify'

export interface WorkspaceRouteOpts {
  id: string
  name: string
  directory: string
  version: string
}

export async function workspaceRoute(
  app: FastifyInstance,
  opts: WorkspaceRouteOpts,
): Promise<void> {
  app.get('/workspace', async () => ({
    id: opts.id,
    name: opts.name,
    directory: opts.directory,
    version: opts.version,
  }))
}
