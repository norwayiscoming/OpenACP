import type { ErrorTracker } from './error-tracker.js'

const MIDDLEWARE_TIMEOUT_MS = 5000

type HandlerEntry = {
  pluginName: string
  priority: number
  handler: Function
}

export class MiddlewareChain {
  private chains = new Map<string, Array<HandlerEntry>>()
  private errorHandler?: (pluginName: string, error: Error) => void
  private errorTracker?: ErrorTracker

  add(
    hook: string,
    pluginName: string,
    opts: { priority?: number; handler: Function },
  ): void {
    const entry: HandlerEntry = {
      pluginName,
      priority: opts.priority ?? 100,
      handler: opts.handler,
    }
    const existing = this.chains.get(hook)
    if (existing) {
      existing.push(entry)
      existing.sort((a, b) => a.priority - b.priority)
    } else {
      this.chains.set(hook, [entry])
    }
  }

  async execute<T>(
    hook: string,
    payload: T,
    coreHandler: (p: T) => T | Promise<T>,
  ): Promise<T | null> {
    const handlers = this.chains.get(hook)
    if (!handlers || handlers.length === 0) {
      return coreHandler(payload)
    }

    // Handlers are pre-sorted by priority at registration time
    const sorted = handlers

    // Build the chain
    let cachedResult: { value: T | null } | undefined = undefined

    const buildNext = (index: number, currentPayload: T): (() => Promise<T | null>) => {
      return async () => {
        // Return cached result on double-call
        if (cachedResult !== undefined) {
          return cachedResult.value
        }

        if (index >= sorted.length) {
          // End of middleware chain — call core handler
          const result = await coreHandler(currentPayload)
          cachedResult = { value: result }
          return result
        }

        const entry = sorted[index]

        // Skip disabled plugins
        if (this.errorTracker?.isDisabled(entry.pluginName)) {
          const skipFn = buildNext(index + 1, currentPayload)
          return skipFn()
        }

        const nextFn = buildNext(index + 1, currentPayload)

        // Wrap next to detect when it has been called and cache
        let nextCalled = false
        let nextResult: T | null = null
        const wrappedNext = async (newPayload?: T): Promise<T | null> => {
          if (!nextCalled) {
            nextCalled = true
            const payloadForNext = newPayload !== undefined ? newPayload : currentPayload
            // Rebuild chain from next index with potentially updated payload
            const newNextFn = buildNext(index + 1, payloadForNext)
            nextResult = await newNextFn()
          }
          return nextResult
        }

        let handlerResult: T | null
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error(`Middleware timeout: ${entry.pluginName} on hook ${hook}`)),
              MIDDLEWARE_TIMEOUT_MS,
            )
            if (typeof timeoutTimer === 'object' && timeoutTimer !== null && 'unref' in timeoutTimer) {
              ;(timeoutTimer as NodeJS.Timeout).unref()
            }
          })

          handlerResult = await Promise.race([
            entry.handler(currentPayload, wrappedNext),
            timeoutPromise,
          ])
        } catch (err) {
          // Report error
          if (this.errorHandler) {
            this.errorHandler(entry.pluginName, err instanceof Error ? err : new Error(String(err)))
          }
          // Track error for circuit-breaking
          this.errorTracker?.increment(entry.pluginName)
          // Skip this handler — pass ORIGINAL payload to next
          return nextFn()
        } finally {
          clearTimeout(timeoutTimer!)
        }

        // Handler returned null — block
        if (handlerResult === null) {
          return null
        }

        return handlerResult
      }
    }

    const start = buildNext(0, payload)
    return start()
  }

  removeAll(pluginName: string): void {
    for (const [hook, handlers] of this.chains.entries()) {
      const filtered = handlers.filter((h) => h.pluginName !== pluginName)
      if (filtered.length === 0) {
        this.chains.delete(hook)
      } else {
        this.chains.set(hook, filtered)
      }
    }
  }

  setErrorHandler(fn: (pluginName: string, error: Error) => void): void {
    this.errorHandler = fn
  }

  setErrorTracker(tracker: ErrorTracker): void {
    this.errorTracker = tracker
  }
}
