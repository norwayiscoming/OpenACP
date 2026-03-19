import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'packages/core/src/cli.ts',
    index: 'packages/core/src/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: true,
  sourcemap: true,
  dts: {
    tsconfig: 'tsconfig.publish.json',
  },
  clean: true,
  outDir: 'dist-publish/dist',
  noExternal: ['@openacp/adapter-telegram'],
  external: [
    'grammy',
    'zod',
    'nanoid',
    '@agentclientprotocol/sdk',
  ],
})
