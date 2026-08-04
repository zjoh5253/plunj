import { defineConfig } from 'prisma/config'

// DATABASE_URL is read lazily so schema-only commands (validate, generate)
// work without a database. Migration/introspection commands require it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
