/** Parameters collected from the user and used across all template generators. */
export interface TemplateParams {
  pluginName: string
  description: string
  author: string
  license: string
  /** Current CLI version — used to pin the openacp engine constraint and SDK version. */
  cliVersion: string
}

/**
 * Generate package.json for a new plugin.
 *
 * The `engines.openacp` field declares the minimum OpenACP CLI version required.
 * The `peerDependencies` entry on `@openacp/cli` is what npm uses for compatibility
 * warnings. Plugin SDK is a devDependency (types only, not bundled).
 */
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
