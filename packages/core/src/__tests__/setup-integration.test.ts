import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ConfigManager } from '../config.js'

// Mock @inquirer/prompts before importing setup
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
}))

// Mock child_process for agent detection
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('claude-agent-acp')) {
      return Buffer.from('/usr/local/bin/claude-agent-acp\n')
    }
    throw new Error('not found')
  }),
}))

import { input, confirm, select, checkbox } from '@inquirer/prompts'
import { runSetup } from '../setup.js'

const mockedInput = vi.mocked(input)
const mockedConfirm = vi.mocked(confirm)
const mockedSelect = vi.mocked(select)
const mockedCheckbox = vi.mocked(checkbox)

describe('runSetup integration', () => {
  let tmpDir: string
  let configPath: string
  const originalEnv = process.env.OPENACP_CONFIG_PATH

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openacp-setup-'))
    configPath = path.join(tmpDir, 'config.json')
    process.env.OPENACP_CONFIG_PATH = configPath

    // Mock fetch for Telegram API validation
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/getMe')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: { first_name: 'TestBot', username: 'test_bot' },
          }),
        })
      }
      if (url.includes('/getChat')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: { title: 'Test Group', type: 'supergroup', is_forum: true },
          }),
        })
      }
      return Promise.reject(new Error('unexpected URL'))
    }))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalEnv === undefined) {
      delete process.env.OPENACP_CONFIG_PATH
    } else {
      process.env.OPENACP_CONFIG_PATH = originalEnv
    }
    vi.restoreAllMocks()
  })

  it('creates valid config file from user input and returns true when user wants to start', async () => {
    // Input call order from setup.ts:
    // 1. setupTelegram: bot token
    // 2. setupTelegram: chat ID
    // 3. setupWorkspace: workspace base dir
    // 4. setupSecurity: allowed user IDs
    // 5. setupSecurity: max concurrent sessions
    // 6. setupSecurity: session timeout
    let inputCallIndex = 0
    mockedInput.mockImplementation((() => {
      const responses = [
        '123:FAKE_TOKEN',    // bot token
        '-1001234567890',    // chat ID
        '~/my-workspace',   // workspace dir
        '',                 // allowed user IDs (empty = all)
        '3',                // max concurrent sessions
        '30',               // session timeout
      ]
      return Promise.resolve(responses[inputCallIndex++])
    }) as any)

    // checkbox: select detected agents (claude-agent-acp is detected)
    mockedCheckbox.mockResolvedValue([{ name: 'claude', command: 'claude-agent-acp' }] as any)

    // confirm calls in order:
    // 1. setupAgents: "Add a custom agent?" → false (since agents were found via checkbox)
    // 2. runSetup: "Save this configuration?" → true
    // 3. runSetup: "Start OpenACP now?" → true
    let confirmCallIndex = 0
    mockedConfirm.mockImplementation((() => {
      const responses = [false, true, true]
      return Promise.resolve(responses[confirmCallIndex++])
    }) as any)

    const cm = new ConfigManager()
    const shouldStart = await runSetup(cm)

    expect(shouldStart).toBe(true)
    expect(fs.existsSync(configPath)).toBe(true)

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.telegram.enabled).toBe(true)
    expect(written.channels.telegram.botToken).toBe('123:FAKE_TOKEN')
    expect(written.channels.telegram.chatId).toBe(-1001234567890)
    expect(written.agents.claude.command).toBe('claude-agent-acp')
    expect(written.defaultAgent).toBe('claude')
    expect(written.workspace.baseDir).toBe('~/my-workspace')
    expect(written.security.maxConcurrentSessions).toBe(3)
    expect(written.security.sessionTimeoutMinutes).toBe(30)
  })

  it('returns false when user declines to save', async () => {
    let inputCallIndex = 0
    mockedInput.mockImplementation((() => {
      const responses = ['123:TOKEN', '-100123', '~', '', '5', '60']
      return Promise.resolve(responses[inputCallIndex++])
    }) as any)

    mockedCheckbox.mockResolvedValue([{ name: 'claude', command: 'claude-agent-acp' }] as any)

    // confirm calls in order:
    // 1. setupAgents: "Add a custom agent?" → false
    // 2. runSetup: "Save this configuration?" → false (user declines)
    let confirmCallIndex = 0
    mockedConfirm.mockImplementation((() => {
      const responses = [false, false] // no custom agent, decline save
      return Promise.resolve(responses[confirmCallIndex++])
    }) as any)

    const cm = new ConfigManager()
    const shouldStart = await runSetup(cm)

    expect(shouldStart).toBe(false)
    expect(fs.existsSync(configPath)).toBe(false)
  })
})
