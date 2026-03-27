import type { TemplateParams } from './package-json.js'

export function generateReadme(params: TemplateParams): string {
  return [
    `# ${params.pluginName}`,
    '',
    params.description || 'An OpenACP plugin.',
    '',
    '## Installation',
    '',
    '```bash',
    `openacp plugin add ${params.pluginName}`,
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
    params.license,
    '',
  ].join('\n')
}
