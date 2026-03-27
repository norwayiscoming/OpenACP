import * as p from '@clack/prompts'
import fs from 'node:fs'
import path from 'node:path'
import { getCurrentVersion } from '../version.js'
import {
  type TemplateParams,
  generatePackageJson,
  generateTsconfig,
  generateGitignore,
  generateNpmignore,
  generateEditorconfig,
  generateReadme,
  generatePluginSource,
  generatePluginTest,
  generateClaudeMd,
  generatePluginGuide,
} from '../plugin-template/index.js'

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

  // Collect template params
  const params: TemplateParams = {
    pluginName,
    description: (result.description as string) || '',
    author: (result.author as string) || '',
    license: result.license as string,
    cliVersion: getCurrentVersion(),
  }

  // Generate and write all files
  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: 'package.json', content: generatePackageJson(params) },
    { relativePath: 'tsconfig.json', content: generateTsconfig() },
    { relativePath: '.gitignore', content: generateGitignore() },
    { relativePath: '.npmignore', content: generateNpmignore() },
    { relativePath: '.editorconfig', content: generateEditorconfig() },
    { relativePath: 'README.md', content: generateReadme(params) },
    { relativePath: 'CLAUDE.md', content: generateClaudeMd(params) },
    { relativePath: 'PLUGIN_GUIDE.md', content: generatePluginGuide(params) },
    { relativePath: path.join('src', 'index.ts'), content: generatePluginSource(params) },
    { relativePath: path.join('src', '__tests__', 'index.test.ts'), content: generatePluginTest(params) },
  ]

  for (const file of files) {
    fs.writeFileSync(path.join(targetDir, file.relativePath), file.content)
  }

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
