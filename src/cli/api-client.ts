import * as fs from 'node:fs'
import * as path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

function defaultPortFile(root: string): string {
  return path.join(root, 'api.port')
}

function defaultSecretFile(root: string): string {
  return path.join(root, 'api-secret')
}

/**
 * Poll the api.port file until it appears (daemon has bound its port) or timeout.
 * Returns the port number, or null if the daemon did not start within timeoutMs.
 */
export async function waitForPortFile(
  portFilePath: string,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = readApiPort(portFilePath)
    if (port !== null) return port
    await sleep(intervalMs)
  }
  return readApiPort(portFilePath)
}

export function readApiPort(portFilePath?: string, instanceRoot?: string): number | null {
  const filePath = portFilePath ?? defaultPortFile(instanceRoot!)
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim()
    const port = parseInt(content, 10)
    return isNaN(port) ? null : port
  } catch {
    return null
  }
}

export function readApiSecret(secretFilePath?: string, instanceRoot?: string): string | null {
  const filePath = secretFilePath ?? defaultSecretFile(instanceRoot!)
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim()
    return content || null
  } catch {
    return null
  }
}

export function removeStalePortFile(portFilePath?: string, instanceRoot?: string): void {
  const filePath = portFilePath ?? defaultPortFile(instanceRoot!)
  try {
    fs.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

export async function apiCall(
  port: number,
  urlPath: string,
  options?: RequestInit,
  instanceRoot?: string,
): Promise<Response> {
  const secret = readApiSecret(undefined, instanceRoot)
  const headers = new Headers(options?.headers)
  if (secret) {
    headers.set('Authorization', `Bearer ${secret}`)
  }
  return fetch(`http://127.0.0.1:${port}${urlPath}`, { ...options, headers })
}
