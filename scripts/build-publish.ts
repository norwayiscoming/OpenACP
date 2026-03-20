import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// 1. Run tsup
console.log('Building with tsup...')
execSync('pnpm tsup --config tsup.config.ts', { cwd: root, stdio: 'inherit' })

// 2. Rename .mjs → .js and .d.mts → .d.ts, update internal imports
const distDir = path.join(root, 'dist-publish/dist')
const files = fs.readdirSync(distDir)
for (const file of files) {
  const filePath = path.join(distDir, file)
  if (file.endsWith('.mjs') || file.endsWith('.d.mts')) {
    // Update import references inside the file
    let content = fs.readFileSync(filePath, 'utf-8')
    content = content.replace(/\.mjs/g, '.js')
    content = content.replace(/\.d\.mts/g, '.d.ts')
    const newName = file.replace('.d.mts', '.d.ts').replace('.mjs', '.js')
    fs.writeFileSync(path.join(distDir, newName), content)
    fs.unlinkSync(filePath)
  } else if (file.endsWith('.mjs.map')) {
    const newName = file.replace('.mjs.map', '.js.map')
    fs.renameSync(filePath, path.join(distDir, newName))
  }
}

// 3. Add shebang to cli.js
const cliPath = path.join(distDir, 'cli.js')
const cliContent = fs.readFileSync(cliPath, 'utf-8')
if (!cliContent.startsWith('#!/usr/bin/env node')) {
  fs.writeFileSync(cliPath, '#!/usr/bin/env node\n' + cliContent)
}
fs.chmodSync(cliPath, 0o755)

// 3. Generate package.json
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
const corePkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/package.json'), 'utf-8'))
const telegramPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/adapters/telegram/package.json'), 'utf-8'))

// Merge dependencies from core + telegram, excluding workspace refs
const deps: Record<string, string> = {}
for (const pkg of [corePkg, telegramPkg]) {
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    if (typeof version === 'string' && !version.startsWith('workspace:')) {
      deps[name] = version
    }
  }
}

const publishPkg = {
  name: '@openacp/cli',
  version: rootPkg.version,
  description: 'Self-hosted bridge for AI coding agents via ACP protocol',
  type: 'module',
  bin: { openacp: './dist/cli.js' },
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  },
  files: ['dist/', 'README.md'],
  engines: { node: '>=20' },
  dependencies: deps,
  repository: {
    type: 'git',
    url: 'https://github.com/nicepkg/OpenACP',
  },
  license: 'AGPL-3.0',
  keywords: ['acp', 'ai', 'coding-agent', 'telegram', 'claude', 'codex'],
}

fs.writeFileSync(
  path.join(root, 'dist-publish/package.json'),
  JSON.stringify(publishPkg, null, 2) + '\n'
)

// 4. Copy README
fs.copyFileSync(
  path.join(root, 'README.md'),
  path.join(root, 'dist-publish/README.md')
)

console.log(`\nBuild complete! Package: @openacp/cli@${rootPkg.version}`)
console.log('To publish: cd dist-publish && npm publish --access=public')
