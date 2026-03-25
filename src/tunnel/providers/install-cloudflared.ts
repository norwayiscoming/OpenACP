import { ensureBinary, type BinarySpec } from '../../core/install-binary.js'

const CLOUDFLARED_SPEC: BinarySpec = {
  name: 'cloudflared',
  githubBaseUrl: 'https://github.com/cloudflare/cloudflared/releases/latest/download',
  platforms: {
    darwin: {
      x64: 'cloudflared-darwin-amd64.tgz',
      arm64: 'cloudflared-darwin-amd64.tgz',
    },
    win32: {
      x64: 'cloudflared-windows-amd64.exe',
    },
    linux: {
      x64: 'cloudflared-linux-amd64',
      arm64: 'cloudflared-linux-arm64',
    },
  },
  isArchive: (url) => url.endsWith('.tgz'),
}

export async function ensureCloudflared(): Promise<string> {
  return ensureBinary(CLOUDFLARED_SPEC)
}
