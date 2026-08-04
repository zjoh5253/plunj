// Minimal ambient declarations for the few Node.js APIs this package uses.
// @plunj/db intentionally has no @types/node dependency yet; delete this file
// if/when @types/node is added to the package.

declare module 'node:crypto' {
  interface Hash {
    update(data: string, encoding?: string): Hash
    digest(encoding: 'hex'): string
  }
  export function createHash(algorithm: string): Hash
}

declare module 'node:module' {
  export function createRequire(specifier: string): (id: string) => unknown
}

declare var process: {
  env: Record<string, string | undefined>
  exitCode?: number
}

declare var console: {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
}

interface ImportMeta {
  url: string
}
