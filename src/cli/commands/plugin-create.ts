import * as p from '@clack/prompts'
import fs from 'node:fs'
import path from 'node:path'
import { getCurrentVersion } from '../version.js'

export async function cmdPluginCreate(): Promise<void> {
  p.intro('Create a new OpenACP plugin')

  const result = await p.group(
    {
      name: () =>
        p.text({
          message: 'Plugin name (e.g., @myorg/adapter-matrix)',
          placeholder: '@myorg/my-plugin',
          validate: (value: string | undefined) => {
            if (!value || !value.trim()) return 'Plugin name is required'
            if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(value.trim())) {
              return 'Must be a valid npm package name (lowercase, hyphens, optional @scope/)'
            }
            return undefined
          },
        }),
      description: () =>
        p.text({
          message: 'Description',
          placeholder: 'A short description of your plugin',
        }),
      author: () =>
        p.text({
          message: 'Author',
          placeholder: 'Your Name <email@example.com>',
        }),
      license: () =>
        p.select({
          message: 'License',
          options: [
            { value: 'MIT', label: 'MIT' },
            { value: 'Apache-2.0', label: 'Apache 2.0' },
            { value: 'ISC', label: 'ISC' },
            { value: 'UNLICENSED', label: 'Unlicensed (private)' },
          ],
        }),
    },
    {
      onCancel: () => {
        p.cancel('Plugin creation cancelled.')
        process.exit(0)
      },
    },
  )

  const pluginName = result.name.trim()
  const dirName = pluginName.replace(/^@[^/]+\//, '') // strip scope for directory name
  const targetDir = path.resolve(process.cwd(), dirName)

  if (fs.existsSync(targetDir)) {
    p.cancel(`Directory "${dirName}" already exists.`)
    process.exit(1)
  }

  const spinner = p.spinner()
  spinner.start('Scaffolding plugin...')

  // Create directory structure
  fs.mkdirSync(path.join(targetDir, 'src', '__tests__'), { recursive: true })

  // Detect CLI version for dependency pinning
  const cliVersion = getCurrentVersion()

  // package.json
  const packageJson = {
    name: pluginName,
    version: '0.1.0',
    description: result.description || '',
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
      test: 'vitest',
      prepublishOnly: 'npm run build',
    },
    author: result.author || '',
    license: result.license as string,
    keywords: ['openacp', 'openacp-plugin'],
    peerDependencies: {
      '@openacp/cli': `>=${cliVersion}`,
    },
    devDependencies: {
      '@openacp/plugin-sdk': cliVersion,
      typescript: '^5.4.0',
      vitest: '^3.0.0',
    },
  }
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
  )

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      declaration: true,
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src'],
    exclude: ['node_modules', 'dist', 'src/**/__tests__'],
  }
  fs.writeFileSync(
    path.join(targetDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
  )

  // .gitignore
  fs.writeFileSync(
    path.join(targetDir, '.gitignore'),
    ['node_modules/', 'dist/', '*.tsbuildinfo', '.DS_Store', ''].join('\n'),
  )

  // .npmignore
  fs.writeFileSync(
    path.join(targetDir, '.npmignore'),
    ['src/', 'tsconfig.json', '.editorconfig', '.gitignore', '*.test.ts', '__tests__/', ''].join('\n'),
  )

  // .editorconfig
  fs.writeFileSync(
    path.join(targetDir, '.editorconfig'),
    [
      'root = true',
      '',
      '[*]',
      'indent_style = space',
      'indent_size = 2',
      'end_of_line = lf',
      'charset = utf-8',
      'trim_trailing_whitespace = true',
      'insert_final_newline = true',
      '',
    ].join('\n'),
  )

  // README.md
  fs.writeFileSync(
    path.join(targetDir, 'README.md'),
    [
      `# ${pluginName}`,
      '',
      result.description || 'An OpenACP plugin.',
      '',
      '## Installation',
      '',
      '```bash',
      `openacp plugin add ${pluginName}`,
      '```',
      '',
      '## Development',
      '',
      '```bash',
      'npm install',
      'npm run build',
      'npm test',
      '',
      '# Live development with hot-reload:',
      `openacp dev .`,
      '```',
      '',
      '## License',
      '',
      result.license as string,
      '',
    ].join('\n'),
  )

  // src/index.ts — full plugin template with all hooks
  const pluginVarName = dirName.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  fs.writeFileSync(
    path.join(targetDir, 'src', 'index.ts'),
    `import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from '@openacp/plugin-sdk'

const plugin: OpenACPPlugin = {
  name: '${pluginName}',
  version: '0.1.0',
  description: '${(result.description || '').replace(/'/g, "\\'")}',

  // Declare which permissions your plugin needs.
  // Available: events:read, events:emit, services:register, services:use,
  //            middleware:register, commands:register, storage:read, storage:write, kernel:access
  permissions: ['events:read', 'services:register'],

  // Dependencies on other plugins (loaded before this one).
  // pluginDependencies: { '@openacp/security': '>=1.0.0' },

  // Optional dependencies (used if available, gracefully degrade if not).
  // optionalPluginDependencies: { '@openacp/usage': '>=1.0.0' },

  /**
   * Called during server startup in dependency order.
   * Register services, middleware, commands, and event listeners here.
   */
  async setup(ctx: PluginContext): Promise<void> {
    ctx.log.info('Plugin setup started')

    // Example: register a service
    // ctx.registerService('my-service', myServiceImpl)

    // Example: listen to events
    // ctx.on('session:created', (event) => { ... })

    // Example: register a slash command
    // ctx.registerCommand({
    //   name: 'mycommand',
    //   description: 'Does something useful',
    //   category: 'plugin',
    //   async handler(args) {
    //     return { type: 'text', text: 'Hello from ${pluginName}!' }
    //   },
    // })

    ctx.log.info('Plugin setup complete')
  },

  /**
   * Called during server shutdown in reverse dependency order.
   * Clean up resources, close connections, stop timers here.
   * Has a 10-second timeout.
   */
  async teardown(): Promise<void> {
    // Clean up resources here
  },

  /**
   * Called when user runs \`openacp plugin add ${pluginName}\`.
   * Use ctx.terminal for interactive prompts to gather configuration.
   */
  async install(ctx: InstallContext): Promise<void> {
    ctx.terminal.log.info('Installing ${pluginName}...')

    // Example: prompt for configuration
    // const apiKey = await ctx.terminal.text({
    //   message: 'Enter your API key',
    //   validate: (v) => v.length === 0 ? 'Required' : undefined,
    // })
    // await ctx.settings.set('apiKey', apiKey)

    ctx.terminal.log.success('Installation complete!')
  },

  /**
   * Called when user runs \`openacp plugin configure ${pluginName}\`.
   * Re-run configuration prompts to update settings.
   */
  async configure(ctx: InstallContext): Promise<void> {
    ctx.terminal.log.info('Configuring ${pluginName}...')

    // Re-run configuration prompts, pre-filling with current values
    // const current = await ctx.settings.getAll()
    // ...

    ctx.terminal.log.success('Configuration updated!')
  },

  /**
   * Called during boot when the plugin version has changed.
   * Migrate settings from the old format to the new format.
   */
  async migrate(ctx: MigrateContext, oldSettings: unknown, oldVersion: string): Promise<unknown> {
    ctx.log.info(\`Migrating from v\${oldVersion}\`)
    // Return the migrated settings object
    return oldSettings
  },

  /**
   * Called when user runs \`openacp plugin remove ${pluginName}\`.
   * Clean up any external resources. If opts.purge is true, delete all data.
   */
  async uninstall(ctx: InstallContext, opts: { purge: boolean }): Promise<void> {
    ctx.terminal.log.info('Uninstalling ${pluginName}...')
    if (opts.purge) {
      await ctx.settings.clear()
    }
    ctx.terminal.log.success('Uninstalled!')
  },
}

export default plugin
`,
  )

  // src/__tests__/index.test.ts
  fs.writeFileSync(
    path.join(targetDir, 'src', '__tests__', 'index.test.ts'),
    `import { describe, it, expect } from 'vitest'
import { createTestContext, createTestInstallContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('${pluginName}', () => {
  it('has correct metadata', () => {
    expect(plugin.name).toBe('${pluginName}')
    expect(plugin.version).toBeDefined()
    expect(plugin.setup).toBeInstanceOf(Function)
  })

  it('sets up without errors', async () => {
    const ctx = createTestContext({
      pluginName: '${pluginName}',
      pluginConfig: { enabled: true },
      permissions: plugin.permissions,
    })
    await expect(plugin.setup(ctx)).resolves.not.toThrow()
  })

  it('tears down without errors', async () => {
    if (plugin.teardown) {
      await expect(plugin.teardown()).resolves.not.toThrow()
    }
  })

  it('installs without errors', async () => {
    if (plugin.install) {
      const ctx = createTestInstallContext({
        pluginName: '${pluginName}',
        terminalResponses: { password: [''], confirm: [true], select: ['apiKey'] },
      })
      await expect(plugin.install(ctx)).resolves.not.toThrow()
    }
  })
})
`,
  )

  spinner.stop('Plugin scaffolded!')

  p.note(
    [
      `cd ${dirName}`,
      'npm install',
      'npm run build',
      'npm test',
      '',
      '# Start development with hot-reload:',
      `openacp dev .`,
    ].join('\n'),
    'Next steps',
  )

  p.outro(`Plugin ${pluginName} created in ./${dirName}`)
}
