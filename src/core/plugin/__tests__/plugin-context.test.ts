import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPluginContext } from '../plugin-context.js'
import { ServiceRegistry } from '../service-registry.js'
import { MiddlewareChain } from '../middleware-chain.js'
import { ErrorTracker } from '../error-tracker.js'
import type { PluginPermission } from '../types.js'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeEventBus() {
  const listeners = new Map<string, Set<Function>>()
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler)
    }),
    emit: vi.fn(),
    _listeners: listeners,
  }
}

function makeContext(permissions: PluginPermission[]) {
  const serviceRegistry = new ServiceRegistry()
  const middlewareChain = new MiddlewareChain()
  const errorTracker = new ErrorTracker()
  const eventBus = makeEventBus()
  const storagePath = mkdtempSync(join(tmpdir(), 'plugin-ctx-test-'))
  const sessions = { list: vi.fn() }
  const config = { get: vi.fn() }

  const ctx = createPluginContext({
    pluginName: 'test-plugin',
    pluginConfig: { foo: 'bar' },
    permissions,
    serviceRegistry,
    middlewareChain,
    errorTracker,
    eventBus: eventBus as any,
    storagePath,
    sessions,
    config,
  })

  return { ctx, serviceRegistry, middlewareChain, eventBus, sessions, config }
}

describe('PluginContext permission enforcement', () => {
  it('throws on registerService without services:register', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.registerService('svc', {})).toThrow(/services:register/)
  })

  it('allows registerService with services:register', () => {
    const { ctx } = makeContext(['services:register'])
    expect(() => ctx.registerService('svc', {})).not.toThrow()
  })

  it('throws on on() without events:read', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.on('test', () => {})).toThrow(/events:read/)
  })

  it('allows on() with events:read', () => {
    const { ctx } = makeContext(['events:read'])
    expect(() => ctx.on('test', () => {})).not.toThrow()
  })

  it('throws on emit() without events:emit', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.emit('test', {})).toThrow(/events:emit/)
  })

  it('allows emit() with events:emit', () => {
    const { ctx, eventBus } = makeContext(['events:emit'])
    ctx.emit('test:event', { data: 1 })
    expect(eventBus.emit).toHaveBeenCalledWith('test:event', { data: 1 })
  })

  it('throws on getService without services:use', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.getService('svc')).toThrow(/services:use/)
  })

  it('throws on registerMiddleware without middleware:register', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.registerMiddleware('message:incoming', { handler: async (p, next) => next() })).toThrow(/middleware:register/)
  })

  it('throws on registerCommand without commands:register', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.registerCommand({ name: 'test', description: 'test', handler: async () => {} })).toThrow(/commands:register/)
  })

  it('throws on storage.set without storage:write', () => {
    const { ctx } = makeContext(['storage:read'])
    expect(() => ctx.storage.set('key', 'val')).rejects.toThrow(/storage:write/)
  })

  it('allows storage.get with storage:read', async () => {
    const { ctx } = makeContext(['storage:read'])
    const result = await ctx.storage.get('nonexistent')
    expect(result).toBeUndefined()
  })

  it('throws on sessions access without kernel:access', () => {
    const { ctx } = makeContext([])
    expect(() => ctx.sessions).toThrow(/kernel:access/)
  })
})

describe('PluginContext identity and log', () => {
  it('exposes pluginName and pluginConfig', () => {
    const { ctx } = makeContext([])
    expect(ctx.pluginName).toBe('test-plugin')
    expect(ctx.pluginConfig).toEqual({ foo: 'bar' })
  })

  it('log is always available', () => {
    const { ctx } = makeContext([])
    expect(ctx.log).toBeDefined()
    expect(() => ctx.log.info('test')).not.toThrow()
    expect(() => ctx.log.error('test')).not.toThrow()
  })
})

describe('PluginContext sendMessage', () => {
  it('sendMessage requires services:use', async () => {
    const { ctx } = makeContext([])
    await expect(ctx.sendMessage('sess-1', { type: 'text', text: 'hi' } as any)).rejects.toThrow(/services:use/)
  })
})

describe('PluginContext cleanup', () => {
  it('auto-cleans event listeners on cleanup()', () => {
    const { ctx, eventBus } = makeContext(['events:read'])
    const handler = vi.fn()
    ctx.on('session:created', handler)
    expect(eventBus.on).toHaveBeenCalledTimes(1)

    ctx.cleanup()
    expect(eventBus.off).toHaveBeenCalledWith('session:created', handler)
  })
})
