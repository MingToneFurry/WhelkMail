/**
 * Resolve the Worker name for a deploy.
 *
 * Workers Builds sets WRANGLER_CI_OVERRIDE_NAME when the Worker name on the
 * dashboard differs from the name in wrangler.jsonc (for example when a user
 * customizes the project name in the Deploy to Cloudflare flow). Passing it to
 * `wrangler deploy --name` makes custom names reliable even when the deploy is
 * a custom npm script. WORKER_NAME and CF_NAME are convenience overrides for
 * local CLI deployments.
 */
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function resolveWorkerName(env = process.env) {
  const raw =
    env.WRANGLER_CI_OVERRIDE_NAME ?? env.WORKER_NAME ?? env.CF_NAME ?? ''
  const name = String(raw).trim()
  if (!name) {
    return null
  }
  if (!WORKER_NAME.test(name)) {
    throw new Error(
      `Invalid Worker name "${name}". Use lowercase letters, digits and dashes, up to 63 characters, without leading or trailing dashes.`,
    )
  }
  return name
}
