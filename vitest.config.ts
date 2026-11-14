import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // workerd builtin, not resolvable in Node: the SMTP/IMAP clients inject
      // their socket in tests, see tests/stubs/cloudflare-sockets.ts.
      'cloudflare:sockets': fileURLToPath(
        new URL('./tests/stubs/cloudflare-sockets.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
