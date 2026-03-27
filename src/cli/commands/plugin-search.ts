import { RegistryClient } from '../../core/plugin/registry-client.js'

export async function cmdPluginSearch(args: string[]): Promise<void> {
  const query = args.join(' ').trim()
  if (!query) {
    console.error('Usage: openacp plugin search <query>')
    process.exit(1)
  }

  const client = new RegistryClient()

  try {
    const results = await client.search(query)

    if (results.length === 0) {
      console.log(`No plugins found matching "${query}"`)
      return
    }

    console.log(`\nFound ${results.length} plugin${results.length > 1 ? 's' : ''} matching "${query}":\n`)
    for (const p of results) {
      const verified = p.verified ? ' ✓' : ''
      const featured = p.featured ? ' ⭐' : ''
      console.log(`  ${p.icon || '📦'} ${p.displayName ?? p.name}${verified}${featured}`)
      console.log(`     ${p.description}`)
      console.log(`     ${p.category} | v${p.version} | npm: ${p.npm}`)
      console.log(`     Install: openacp plugin install ${p.name}`)
      console.log()
    }
  } catch (err) {
    console.error(`Failed to search registry: ${err}`)
    process.exit(1)
  }
}
