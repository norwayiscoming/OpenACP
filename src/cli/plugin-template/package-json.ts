export interface TemplateParams {
  pluginName: string
  description: string
  author: string
  license: string
  cliVersion: string
}

export function generatePackageJson(params: TemplateParams): string {
  const packageJson = {
    name: params.pluginName,
    version: '0.1.0',
    description: params.description || '',
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
      test: 'vitest',
      prepublishOnly: 'npm run build',
    },
    author: params.author || '',
    license: params.license,
    keywords: ['openacp', 'openacp-plugin'],
    engines: {
      openacp: `>=${params.cliVersion}`,
    },
    peerDependencies: {
      '@openacp/cli': `>=${params.cliVersion}`,
    },
    devDependencies: {
      '@openacp/plugin-sdk': params.cliVersion,
      typescript: '^5.4.0',
      vitest: '^3.0.0',
    },
  }
  return JSON.stringify(packageJson, null, 2) + '\n'
}
