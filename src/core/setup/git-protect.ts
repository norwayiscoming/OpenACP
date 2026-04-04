import fs from 'node:fs'
import path from 'node:path'

/**
 * Ensure .openacp/ is excluded from git and documented in CLAUDE.md.
 * Called after creating a local (non-global) instance.
 *
 * - If in a git repo: auto-add to .gitignore, show warning
 * - If CLAUDE.md exists: add ignore note
 * - If .gitignore or CLAUDE.md don't exist: create them
 */
export function protectLocalInstance(projectDir: string): void {
  // Always create .gitignore and CLAUDE.md — even if not a git repo yet,
  // user may git init later and these protect secrets proactively
  ensureGitignore(projectDir)
  ensureClaudeMd(projectDir)
  printSecurityWarning()
}

function ensureGitignore(projectDir: string): void {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const entry = '.openacp'

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8')
    // Check if already ignored (exact line match)
    const lines = content.split('\n').map(l => l.trim())
    if (lines.includes(entry) || lines.includes('.openacp')) {
      return // Already protected
    }
    // Append to existing .gitignore
    const separator = content.endsWith('\n') ? '' : '\n'
    fs.appendFileSync(gitignorePath, `${separator}\n# OpenACP local workspace (contains secrets)\n${entry}\n`)
  } else {
    // Create new .gitignore
    fs.writeFileSync(gitignorePath, `# OpenACP local workspace (contains secrets)\n${entry}\n`)
  }
}

function ensureClaudeMd(projectDir: string): void {
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md')
  const marker = '## Local OpenACP Workspace'

  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf-8')
    if (content.includes(marker)) {
      return // Already documented
    }
    const separator = content.endsWith('\n') ? '' : '\n'
    fs.appendFileSync(claudeMdPath, `${separator}\n## Local OpenACP Workspace\n\nThe \`.openacp/\` directory contains a local OpenACP workspace with secrets (bot tokens, API keys). Do not read, commit, or reference files inside it.\n`)
  } else {
    fs.writeFileSync(claudeMdPath, `# CLAUDE.md\n\n## Local OpenACP Workspace\n\nThe \`.openacp/\` directory contains a local OpenACP workspace with secrets (bot tokens, API keys). Do not read, commit, or reference files inside it.\n`)
  }
}

function printSecurityWarning(): void {
  const red = '\x1b[1;91m'
  const yellow = '\x1b[1;33m'
  const reset = '\x1b[0m'
  const dim = '\x1b[2m'

  console.log('')
  console.log(`${red}  ⚠  SECURITY WARNING${reset}`)
  console.log(`${red}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`)
  console.log(`${yellow}  .openacp/ contains bot tokens and API secrets.${reset}`)
  console.log(`${yellow}  It has been added to .gitignore automatically.${reset}`)
  console.log(`${dim}  Verify before committing: git status${reset}`)
  console.log(`${red}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`)
  console.log('')
}
