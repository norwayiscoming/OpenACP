// --- Types ---

export interface JsonSuccess<T = unknown> {
  success: true
  data: T
}

export interface JsonError {
  success: false
  error: {
    code: string
    message: string
  }
}

export type JsonOutput<T = unknown> = JsonSuccess<T> | JsonError

// --- Error Codes ---

export const ErrorCodes = {
  DAEMON_NOT_RUNNING: 'DAEMON_NOT_RUNNING',
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  SETUP_FAILED: 'SETUP_FAILED',
  API_ERROR: 'API_ERROR',
  TUNNEL_ERROR: 'TUNNEL_ERROR',
  INSTALL_FAILED: 'INSTALL_FAILED',
  UNINSTALL_FAILED: 'UNINSTALL_FAILED',
  MISSING_ARGUMENT: 'MISSING_ARGUMENT',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

// --- Functions ---

export function isJsonMode(args: string[]): boolean {
  return args.includes('--json')
}

export function jsonSuccess(data: unknown): never {
  console.log(JSON.stringify({ success: true, data }))
  process.exit(0)
}

export function jsonError(code: ErrorCode, message: string): never {
  console.log(JSON.stringify({ success: false, error: { code, message } }))
  process.exit(1)
}

export async function muteForJson(): Promise<void> {
  try {
    const { muteLogger } = await import('../core/utils/log.js')
    muteLogger()
  } catch {
    // pino not initialized — nothing to mute, that's fine
  }
}
