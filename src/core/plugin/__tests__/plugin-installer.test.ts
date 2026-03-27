import { describe, it, expect, vi } from 'vitest'
import { installNpmPlugin } from '../plugin-installer.js'

describe('installNpmPlugin — package name validation', () => {
  // Shell injection attempts must be rejected before any exec
  const maliciousNames = [
    'foo; rm -rf /',
    '$(whoami)',
    'foo`id`bar',
    'foo && bar',
    'foo | bar',
    'foo > /tmp/out',
    '../../../etc/passwd',
    'foo\nbar',
  ]

  for (const name of maliciousNames) {
    it(`rejects shell metacharacter input: ${JSON.stringify(name)}`, async () => {
      await expect(installNpmPlugin(name, '/tmp/nonexistent-plugins-dir')).rejects.toThrow(
        'Invalid package name',
      )
    })
  }

  // Valid names should NOT throw "Invalid package name" — they may fail further down the stack
  // (e.g., npm install) but validation itself must pass.
  const validNames = [
    'my-openacp-plugin',
    'my.plugin',
    '@scope/my-plugin',
    '@openacp/telegram',
    'my-plugin@4.17.21',
    '@scope/pkg@^1.0.0',
    'MY-PLUGIN',
  ]

  for (const name of validNames) {
    it(`accepts valid npm package name: ${JSON.stringify(name)}`, async () => {
      // These will throw because the plugins dir doesn't exist or npm install fails,
      // but the error must NOT be "Invalid package name"
      const result = await installNpmPlugin(name, '/tmp/nonexistent-plugins-dir').catch((e: Error) => e)
      if (result instanceof Error) {
        expect(result.message).not.toContain('Invalid package name')
      }
      // If it resolved (unlikely in test env), validation definitely passed
    })
  }
})
