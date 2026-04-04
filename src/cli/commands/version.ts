import { isJsonMode, jsonSuccess, muteForJson } from '../output.js'

export async function cmdVersion(args: string[] = []): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const { getCurrentVersion } = await import('../version.js')
  const version = getCurrentVersion()

  if (json) {
    jsonSuccess({ version })
  }

  console.log(`openacp v${version}`)
}
