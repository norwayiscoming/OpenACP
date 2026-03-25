import { ensureBinary, type BinarySpec } from './install-binary.js'

const JQ_SPEC: BinarySpec = {
  name: 'jq',
  githubBaseUrl: 'https://github.com/jqlang/jq/releases/latest/download',
  platforms: {
    darwin: {
      x64: 'jq-macos-amd64',
      arm64: 'jq-macos-arm64',
    },
    win32: {
      x64: 'jq-windows-amd64.exe',
    },
    linux: {
      x64: 'jq-linux-amd64',
      arm64: 'jq-linux-arm64',
    },
  },
}

export async function ensureJq(): Promise<string> {
  return ensureBinary(JQ_SPEC)
}
