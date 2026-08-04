/**
 * Vitest globalSetup: boots a REAL ephemeral Postgres 17 (homebrew binaries)
 * on a non-standard port, applies the Prisma schema via `prisma db push` plus
 * the raw constraints in packages/db/prisma/sql/constraints.sql, and tears the
 * whole thing down (data dir included) after the run.
 *
 * Everything is deterministic constants so test files can import DATABASE_URL
 * directly even though globalSetup runs in a separate module context.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Postgres binaries: $PG_BIN, else the first known install dir, else $PATH.
const PG_BIN =
  process.env.PG_BIN ??
  ['/opt/homebrew/bin', '/usr/local/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].find(
    (dir) => existsSync(join(dir, 'initdb')),
  ) ??
  ''
const PG_DIR = join(tmpdir(), 'plunj-pg-api')
const DATA_DIR = join(PG_DIR, 'data')
const PG_PORT = 54331
const PG_USER = 'plunj'
const PG_DATABASE = 'plunj_api_test'

export const DATABASE_URL = `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DATABASE}`

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

function pg(cmd: string, args: string[]): void {
  // LC_ALL=C avoids "postmaster became multithreaded during startup" on macOS,
  // where locale lookup via CoreFoundation spawns a thread before fork.
  execFileSync(PG_BIN ? join(PG_BIN, cmd) : cmd, args, {
    stdio: 'pipe',
    env: { ...process.env, LC_ALL: 'C' },
  })
}

export default async function setup(): Promise<() => Promise<void>> {
  // Fresh cluster every run — wipe any leftovers from a crashed previous run.
  try {
    pg('pg_ctl', ['-D', DATA_DIR, '-m', 'immediate', 'stop'])
  } catch {
    // not running — fine
  }
  rmSync(PG_DIR, { recursive: true, force: true })
  mkdirSync(PG_DIR, { recursive: true })

  pg('initdb', ['-D', DATA_DIR, '-U', PG_USER, '-A', 'trust', '--no-sync'])
  pg('pg_ctl', [
    '-D',
    DATA_DIR,
    '-l',
    join(PG_DIR, 'postgres.log'),
    '-w',
    '-o',
    // Unix sockets disabled (the scratchpad path exceeds the 103-byte socket
    // limit); TCP-only on a non-standard port never collides with a system postgres.
    `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off`,
    'start',
  ])
  pg('createdb', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', PG_USER, PG_DATABASE])

  // Apply the Prisma schema, then the raw-SQL constraints Prisma can't express
  // (notably sessions_booked_seats_within_capacity — invariant #3's backstop).
  execFileSync('pnpm', ['--filter', '@plunj/db', 'exec', 'prisma', 'db', 'push'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  })
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

  return async () => {
    try {
      pg('pg_ctl', ['-D', DATA_DIR, '-m', 'immediate', 'stop'])
    } finally {
      rmSync(PG_DIR, { recursive: true, force: true })
    }
  }
}
