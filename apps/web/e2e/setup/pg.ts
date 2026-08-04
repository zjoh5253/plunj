/**
 * Ephemeral Postgres for the E2E suite — same pattern as
 * packages/availability/test/pgserver.ts, on its own port (54333) and tmpdir
 * ('plunj-pg-e2e') so it never collides with the unit-test clusters or a
 * system postgres. Deterministic constants so spec files can import
 * DATABASE_URL / psql() even though globalSetup runs in a separate module
 * context.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Postgres binaries: $PG_BIN, else the first known install dir, else $PATH.
export const PG_BIN =
  process.env.PG_BIN ??
  [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
  ].find((dir) => existsSync(join(dir, 'initdb'))) ??
  ''

export const PG_DIR = join(tmpdir(), 'plunj-pg-e2e')
export const DATA_DIR = join(PG_DIR, 'data')
export const PG_PORT = 54333
export const PG_USER = 'plunj'
export const PG_DATABASE = 'plunj_e2e'

export const DATABASE_URL = `postgresql://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DATABASE}`

export const REPO_ROOT = join(__dirname, '..', '..', '..', '..')

export function pg(cmd: string, args: string[]): string {
  // LC_ALL=C avoids "postmaster became multithreaded during startup" on macOS,
  // where locale lookup via CoreFoundation spawns a thread before fork.
  return execFileSync(PG_BIN ? join(PG_BIN, cmd) : cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
  })
}

/** Run one SQL statement against the E2E database; returns trimmed -tA output. */
export function psql(sql: string): string {
  return pg('psql', [
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
    '-tA',
    '-c',
    sql,
  ]).trim()
}

export function startCluster(): void {
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
    // Unix sockets disabled (tmp paths can exceed the 103-byte socket limit);
    // TCP-only on a non-standard port never collides with a system postgres.
    `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off`,
    'start',
  ])
  pg('createdb', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', PG_USER, PG_DATABASE])
}

export function stopCluster(): void {
  try {
    pg('pg_ctl', ['-D', DATA_DIR, '-m', 'immediate', 'stop'])
  } finally {
    rmSync(PG_DIR, { recursive: true, force: true })
  }
}
