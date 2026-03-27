export function generateGitignore(): string {
  return ['node_modules/', 'dist/', '*.tsbuildinfo', '.DS_Store', ''].join('\n')
}

export function generateNpmignore(): string {
  return ['src/', 'tsconfig.json', '.editorconfig', '.gitignore', '*.test.ts', '__tests__/', ''].join('\n')
}

export function generateEditorconfig(): string {
  return [
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
  ].join('\n')
}
