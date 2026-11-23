import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWorkerName } from './worker-name.mjs'

let name
try {
  name = resolveWorkerName()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const wrangler = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if (!existsSync(wrangler)) {
  console.error('Wrangler is not installed. Run npm install first.')
  process.exit(1)
}

const args = [
  wrangler,
  'deploy',
  ...(name ? ['--name', name] : []),
  ...process.argv.slice(2),
]
const result = spawnSync(process.execPath, args, { stdio: 'inherit' })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
