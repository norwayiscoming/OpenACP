import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiddlewareChain } from '../middleware-chain.js'

type NextFn<T = unknown> = (payload?: T) => Promise<T | null>

describe('MiddlewareChain', () => {
  let chain: MiddlewareChain

  beforeEach(() => {
    chain = new MiddlewareChain()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes handler when no middleware registered', async () => {
    const coreHandler = vi.fn().mockImplementation((p: { value: number }) => ({ value: p.value * 2 }))
    const result = await chain.execute('message:incoming', { value: 5 } as any, coreHandler)
    expect(coreHandler).toHaveBeenCalledWith({ value: 5 })
    expect(result).toEqual({ value: 10 })
  })

  it('middleware can modify payload', async () => {
    chain.add('message:incoming', 'plugin-a', {
      handler: async (payload: { value: number }, next: NextFn<{ value: number }>) => {
        return next({ ...payload, value: payload.value + 1 })
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: { value: number }) => ({ value: p.value * 2 }))
    const result = await chain.execute('message:incoming', { value: 5 } as any, coreHandler)
    // payload modified from 5 to 6 before coreHandler, then doubled to 12
    expect(result).toEqual({ value: 12 })
  })

  it('middleware can block by returning null', async () => {
    chain.add('message:incoming', 'plugin-blocker', {
      handler: async (_payload: unknown, _next: NextFn) => {
        return null
      },
    })
    const coreHandler = vi.fn().mockResolvedValue({ value: 99 })
    const result = await chain.execute('message:incoming', { value: 5 } as any, coreHandler)
    expect(result).toBeNull()
    expect(coreHandler).not.toHaveBeenCalled()
  })

  it('executes middleware in registration order', async () => {
    const order: string[] = []
    chain.add('agent:beforePrompt', 'plugin-a', {
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('a')
        return next()
      },
    })
    chain.add('agent:beforePrompt', 'plugin-b', {
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('b')
        return next()
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: unknown) => p)
    await chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi', attachments: [] }, coreHandler)
    expect(order).toEqual(['a', 'b'])
  })

  it('priority overrides registration order (lower priority = earlier)', async () => {
    const order: string[] = []
    chain.add('agent:beforePrompt', 'plugin-late', {
      priority: 10,
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('late')
        return next()
      },
    })
    chain.add('agent:beforePrompt', 'plugin-early', {
      priority: 1,
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('early')
        return next()
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: unknown) => p)
    await chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi' }, coreHandler)
    expect(order).toEqual(['early', 'late'])
  })

  it('skips middleware that throws and continues chain', async () => {
    const errorHandler = vi.fn()
    chain.setErrorHandler(errorHandler)

    chain.add('agent:beforePrompt', 'plugin-bad', {
      handler: async (_payload: unknown, _next: NextFn) => {
        throw new Error('boom')
      },
    })
    chain.add('agent:beforePrompt', 'plugin-good', {
      handler: async (_payload: unknown, next: NextFn) => {
        return next()
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: unknown) => p)
    const result = await chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi' }, coreHandler)
    // chain continues with original payload, coreHandler is called
    expect(coreHandler).toHaveBeenCalled()
    expect(result).not.toBeNull()
    expect(errorHandler).toHaveBeenCalledWith('plugin-bad', expect.any(Error))
  })

  it('times out middleware after 5 seconds', async () => {
    vi.useFakeTimers()

    chain.add('agent:beforePrompt', 'plugin-slow', {
      handler: async (_payload: unknown, _next: NextFn) => {
        // never resolves
        return new Promise<never>(() => {})
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: unknown) => p)

    const executePromise = chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi' }, coreHandler)

    // advance past 5s timeout
    await vi.advanceTimersByTimeAsync(5001)

    const result = await executePromise
    // timed-out middleware is skipped, core handler still runs
    expect(coreHandler).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('removes all middleware for a plugin', async () => {
    const order: string[] = []
    chain.add('agent:beforePrompt', 'plugin-a', {
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('a')
        return next()
      },
    })
    chain.add('agent:beforeEvent', 'plugin-a', {
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('a-event')
        return next()
      },
    })
    chain.add('agent:beforePrompt', 'plugin-b', {
      handler: async (_payload: unknown, next: NextFn) => {
        order.push('b')
        return next()
      },
    })

    chain.removeAll('plugin-a')

    const coreHandler = vi.fn().mockImplementation((p: unknown) => p)
    await chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi' }, coreHandler)
    await chain.execute('agent:beforeEvent', { sessionId: 's1', event: {} as any }, coreHandler)

    expect(order).toEqual(['b'])
  })

  it('double next() call returns cached result', async () => {
    let nextCallCount = 0
    chain.add('agent:beforePrompt', 'plugin-double', {
      handler: async (_payload: unknown, next: NextFn) => {
        // call next twice
        const r1 = await next()
        nextCallCount++
        const r2 = await next()
        nextCallCount++
        // both calls should return the same result
        expect(r1).toBe(r2)
        return r1
      },
    })
    const coreHandler = vi.fn().mockImplementation((p: unknown) => ({ ...(p as object), processed: true }))
    await chain.execute('agent:beforePrompt', { sessionId: 's1', text: 'hi' }, coreHandler)
    // coreHandler should only be called once despite double next()
    expect(coreHandler).toHaveBeenCalledTimes(1)
    expect(nextCallCount).toBe(2)
  })
})
