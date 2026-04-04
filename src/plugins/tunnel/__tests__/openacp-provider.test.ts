import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenACPTunnelProvider } from '../providers/openacp.js'
import type { PluginStorage } from '../../../core/plugin/types.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})
vi.mock('../../../core/agents/agent-dependencies.js', () => ({
  commandExists: vi.fn(() => false),
}))
vi.mock('../providers/install-cloudflared.js', () => ({
  ensureCloudflared: vi.fn().mockResolvedValue('/mock/cloudflared'),
}))

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

function makeStorage(initial: Record<string, unknown> = {}): PluginStorage {
  const store: Record<string, unknown> = { ...initial }
  return {
    get: vi.fn(async (key: string) => store[key] as any),
    set: vi.fn(async (key: string, value: unknown) => { store[key] = value }),
    delete: vi.fn(async (key: string) => { delete store[key] }),
    list: vi.fn(async () => Object.keys(store)),
    getDataDir: vi.fn(() => '/tmp/test-storage'),
  } as any
}

function makeProcess(exitCode: number | null = null, exitAfterMs = 20_000): any {
  const proc = new EventEmitter() as any
  proc.kill = vi.fn()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  if (exitAfterMs < 20_000) {
    setTimeout(() => proc.emit('exit', exitCode), exitAfterMs)
  }
  return proc
}

describe('OpenACPTunnelProvider', () => {
  let storage: ReturnType<typeof makeStorage>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = makeStorage()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('creates a new tunnel when no saved state', async () => {
    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tunnelId: 'cf-123',
        token: 'tok-abc',
        publicUrl: 'https://abc.tunnel.openacp.ai',
      }),
    })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    const url = await startPromise

    expect(url).toBe('https://abc.tunnel.openacp.ai')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tunnel/create'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(storage.set).toHaveBeenCalledWith('openacp-tunnels', {
      '3100': { tunnelId: 'cf-123', token: 'tok-abc', publicUrl: 'https://abc.tunnel.openacp.ai' },
    })
  })

  it('reuses saved tunnel when worker ping returns 200', async () => {
    const saved = { '3100': { tunnelId: 'cf-old', token: 'tok-old', publicUrl: 'https://old.tunnel.openacp.ai' } }
    storage = makeStorage({ 'openacp-tunnels': saved })

    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    const url = await startPromise

    expect(url).toBe('https://old.tunnel.openacp.ai')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tunnel/cf-old/ping'),
      expect.anything(),
    )
  })

  it('creates new tunnel when saved state ping fails', async () => {
    const saved = { '3100': { tunnelId: 'cf-old', token: 'tok-old', publicUrl: 'https://old.tunnel.openacp.ai' } }
    storage = makeStorage({ 'openacp-tunnels': saved })

    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tunnelId: 'cf-new', token: 'tok-new', publicUrl: 'https://new.tunnel.openacp.ai' }),
      })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    const url = await startPromise

    expect(url).toBe('https://new.tunnel.openacp.ai')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws when cloudflared exits before 15s startup window', async () => {
    const proc = makeProcess(1, 100)
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tunnelId: 'cf-x', token: 'tok-x', publicUrl: 'https://x.tunnel.openacp.ai' }),
    })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(200)

    await expect(startPromise).rejects.toThrow('exited with code 1')
  })

  it('does not delete state on crash, fires onExit callback', async () => {
    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tunnelId: 'cf-123', token: 'tok-abc', publicUrl: 'https://abc.tunnel.openacp.ai' }),
    })

    const onExit = vi.fn()
    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    provider.onExit(onExit)

    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    await startPromise

    proc.emit('exit', 1)

    expect(onExit).toHaveBeenCalledWith(1)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('deletes state and calls worker DELETE on explicit stop', async () => {
    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tunnelId: 'cf-123', token: 'tok', publicUrl: 'https://abc.tunnel.openacp.ai' }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    await startPromise

    await provider.stop()

    const deleteCalls = fetchMock.mock.calls.filter(([url, init]: [string, RequestInit]) =>
      String(url).includes('/tunnel/cf-123') && init?.method === 'DELETE'
    )
    expect(deleteCalls.length).toBe(1)
    expect(storage.set).toHaveBeenLastCalledWith('openacp-tunnels', {})
  })

  it('stop(force=true) sends SIGKILL immediately without escalation delay', async () => {
    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tunnelId: 'cf-123', token: 'tok', publicUrl: 'https://abc.tunnel.openacp.ai' }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    await startPromise

    await provider.stop(true)

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    expect(proc.kill).toHaveBeenCalledTimes(1)
  })

  it('heartbeat pings worker every 10 minutes after start', async () => {
    const proc = makeProcess()
    vi.mocked(spawn).mockReturnValue(proc as any)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tunnelId: 'cf-123', token: 'tok', publicUrl: 'https://abc.tunnel.openacp.ai' }),
    })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    const startPromise = provider.start(3100)
    await vi.advanceTimersByTimeAsync(15_001)
    await startPromise

    const pingsBefore = fetchMock.mock.calls.filter(([url]: [string]) =>
      String(url).includes('/ping')
    ).length
    expect(pingsBefore).toBe(0)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    const pingsAfter = fetchMock.mock.calls.filter(([url]: [string]) =>
      String(url).includes('/ping')
    ).length
    expect(pingsAfter).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tunnel/cf-123/ping'),
      expect.anything(),
    )
  })

  it('throws when worker returns 429 on create', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"error":"Rate limit exceeded. Max 5 tunnels per hour."}',
    })

    const provider = new OpenACPTunnelProvider({}, '/mock/bin', storage)
    await expect(provider.start(3100)).rejects.toThrow('429')
  })
})
