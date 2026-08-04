/**
 * Playwright globalSetup: boot the ephemeral Postgres, apply the Prisma schema
 * plus the raw-SQL constraints, seed (Provo location, discount codes, staff),
 * and generate ~3 days of sessions. The webServer (next dev) is started by
 * Playwright afterwards with DATABASE_URL pointing at this cluster.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { DATABASE_URL, PG_PORT, PG_USER, PG_DATABASE, REPO_ROOT, pg, startCluster } from './pg'

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  })
}

export default async function globalSetup(): Promise<void> {
  console.log(`[e2e] booting ephemeral postgres on 127.0.0.1:${PG_PORT} (${PG_DATABASE})`)
  startCluster()

  // Schema + the raw constraints Prisma can't express (invariant #3 backstop).
  run('pnpm', ['--filter', '@plunj/db', 'exec', 'prisma', 'db', 'push'])
  pg('psql', [
    '-h',
    '127.0.0.1',
    '-p',
    String(PG_PORT),
    '-U',
    PG_USER,
    '-d',
    PG_DATABASE,
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    join(REPO_ROOT, 'packages/db/prisma/sql/constraints.sql'),
  ])

  // Seed: Provo (slug 'provo', taxRateBps 725), hourly $45 session templates,
  // WELCOME20 / FIRSTTIMER / TENOFF discount codes, staff users.
  run('pnpm', ['--filter', '@plunj/db', 'db:seed'])

  // Generate concrete Session rows for today + 3 days.
  run('pnpm', [
    '--filter',
    '@plunj/db',
    'exec',
    'tsx',
    join(__dirname, 'generate.mts'),
  ])
}
