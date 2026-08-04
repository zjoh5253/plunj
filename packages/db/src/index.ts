import { createRequire } from 'node:module'
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client'
import { uuidv7 } from 'uuidv7'
import { PrismaClient } from './generated/prisma/client.js'

// Re-export the full generated surface: PrismaClient, the Prisma namespace,
// all model types, and all enums.
export * from './generated/prisma/client.js'

/**
 * Generate a UUIDv7. Every row id in the PLUNJ schema is created in app code
 * with this helper — never by the database.
 */
export function id(): string {
  return uuidv7()
}

const require_ = createRequire(import.meta.url)

/**
 * Prisma 7 connects through a driver adapter. We resolve one dynamically so
 * this package can be imported for types, enums, and `id()` without a database
 * or adapter installed (e.g. in pure pricing-kernel tests).
 */
function resolveAdapter(): SqlDriverAdapterFactory {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('@plunj/db: DATABASE_URL is not set')
  }

  type AdapterCtor = new (config: { connectionString: string }) => SqlDriverAdapterFactory
  const candidates: Array<[pkg: string, exportName: string]> = [
    ['@prisma/adapter-neon', 'PrismaNeon'],
    ['@prisma/adapter-pg', 'PrismaPg'],
  ]
  // The Neon adapter only speaks WebSocket — for a non-Neon (local/CI TCP)
  // DATABASE_URL prefer the plain pg adapter so the connection can succeed.
  if (!/neon\.tech/i.test(connectionString)) candidates.reverse()

  for (const [pkg, exportName] of candidates) {
    let mod: Record<string, unknown>
    try {
      mod = require_(pkg) as Record<string, unknown>
    } catch {
      continue
    }
    const Adapter = mod[exportName] as AdapterCtor | undefined
    if (Adapter) return new Adapter({ connectionString })
  }

  throw new Error(
    '@plunj/db: no Prisma driver adapter found. Install @prisma/adapter-neon (or @prisma/adapter-pg) in the consuming app.',
  )
}

const globalForPrisma = globalThis as unknown as { __plunjPrisma?: PrismaClient }

function getClient(): PrismaClient {
  // Cached on globalThis so Next.js dev-server hot reloads reuse one client.
  return (globalForPrisma.__plunjPrisma ??= new PrismaClient({ adapter: resolveAdapter() }))
}

/**
 * Shared PrismaClient singleton. Instantiated lazily on first use so importing
 * this package never requires a database connection.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient()
    const value = Reflect.get(client, prop, client) as unknown
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value
  },
})
