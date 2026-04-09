import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('../core/log.js', () => ({
  createChildLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}))

describe('autostart', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openacp-autostart-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('escapeXml', () => {
    it('escapes XML special characters', async () => {
      const { escapeXml } = await import('../cli/autostart.js')
      expect(escapeXml('a & b')).toBe('a &amp; b')
      expect(escapeXml('<script>')).toBe('&lt;script&gt;')
      expect(escapeXml('"hello"')).toBe('&quot;hello&quot;')
      expect(escapeXml("it's")).toBe('it&apos;s')
      expect(escapeXml('/normal/path')).toBe('/normal/path')
    })
  })

  describe('escapeSystemdValue', () => {
    it('quotes and escapes systemd special characters', async () => {
      const { escapeSystemdValue } = await import('../cli/autostart.js')
      expect(escapeSystemdValue('/usr/bin/node')).toBe('"/usr/bin/node"')
      expect(escapeSystemdValue('/path with spaces/node')).toBe('"/path with spaces/node"')
      expect(escapeSystemdValue('/path"quote')).toBe('"/path\\"quote"')
      expect(escapeSystemdValue('/path\\back')).toBe('"/path\\\\back"')
      expect(escapeSystemdValue('/path%specifier')).toBe('"/path%%specifier"')
      expect(escapeSystemdValue('/home/$USER/bin')).toBe('"/home/$$USER/bin"')
    })
  })

  describe('generateLaunchdPlist', () => {
    it('generates valid plist with absolute paths', async () => {
      const { generateLaunchdPlist } = await import('../cli/autostart.js')
      const plist = generateLaunchdPlist('/usr/local/bin/node', '/usr/local/lib/cli.js', '/Users/test/.openacp/logs')
      expect(plist).toContain('/usr/local/bin/node')
      expect(plist).toContain('/usr/local/lib/cli.js')
      expect(plist).toContain('--daemon-child')
      expect(plist).toContain('com.openacp.daemon')
      expect(plist).not.toContain('~')
    })

    it('includes OPENACP_INSTANCE_ROOT in EnvironmentVariables when instanceRoot provided', async () => {
      const { generateLaunchdPlist } = await import('../cli/autostart.js')
      const plist = generateLaunchdPlist('/usr/bin/node', '/usr/bin/openacp', '/logs', '/Users/test/workspace/.openacp')
      expect(plist).toContain('<key>EnvironmentVariables</key>')
      expect(plist).toContain('<key>OPENACP_INSTANCE_ROOT</key>')
      expect(plist).toContain('<string>/Users/test/workspace/.openacp</string>')
    })

    it('omits EnvironmentVariables block when instanceRoot not provided', async () => {
      const { generateLaunchdPlist } = await import('../cli/autostart.js')
      const plist = generateLaunchdPlist('/usr/bin/node', '/usr/bin/openacp', '/logs')
      expect(plist).not.toContain('EnvironmentVariables')
      expect(plist).not.toContain('OPENACP_INSTANCE_ROOT')
    })

    it('escapes special characters in paths', async () => {
      const { generateLaunchdPlist } = await import('../cli/autostart.js')
      const plist = generateLaunchdPlist('/usr/bin/no<de', '/path/"cli".js', '/logs/a&b')
      expect(plist).toContain('<string>/usr/bin/no&lt;de</string>')
      expect(plist).toContain('<string>/path/&quot;cli&quot;.js</string>')
      expect(plist).toContain('<string>/logs/a&amp;b/openacp.log</string>')
      expect(plist).not.toContain('<de')
    })

    it('escapes special characters in instanceRoot', async () => {
      const { generateLaunchdPlist } = await import('../cli/autostart.js')
      const plist = generateLaunchdPlist('/usr/bin/node', '/usr/bin/openacp', '/logs', '/path/with&special/root')
      expect(plist).toContain('<string>/path/with&amp;special/root</string>')
    })
  })

  describe('generateSystemdUnit', () => {
    it('generates valid unit file with absolute paths', async () => {
      const { generateSystemdUnit } = await import('../cli/autostart.js')
      const unit = generateSystemdUnit('/usr/bin/node', '/usr/lib/cli.js')
      expect(unit).toContain('/usr/bin/node')
      expect(unit).toContain('/usr/lib/cli.js')
      expect(unit).toContain('--daemon-child')
      expect(unit).toContain('Restart=on-failure')
    })

    it('escapes special characters in paths', async () => {
      const { generateSystemdUnit } = await import('../cli/autostart.js')
      const unit = generateSystemdUnit('/usr/bin/no de', '/path/"cli".js')
      expect(unit).toContain('ExecStart="/usr/bin/no de" "/path/\\"cli\\".js" --daemon-child')
    })

    it('escapes percent specifiers', async () => {
      const { generateSystemdUnit } = await import('../cli/autostart.js')
      const unit = generateSystemdUnit('/usr/bin/node', '/home/%user/cli.js')
      expect(unit).toContain('%%user')
    })
  })

  describe('isAutoStartSupported', () => {
    it('returns true on darwin', async () => {
      const { isAutoStartSupported } = await import('../cli/autostart.js')
      const supported = isAutoStartSupported()
      if (process.platform === 'darwin' || process.platform === 'linux') {
        expect(supported).toBe(true)
      } else {
        expect(supported).toBe(false)
      }
    })
  })
})
