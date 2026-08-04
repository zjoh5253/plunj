// Minimal ambient declarations for the test files only. The money package is
// intentionally zero-dependency (no @types/node), but tests run under Node via
// vitest and need these few globals.

declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string
}

interface ImportMeta {
  url: string
}

declare class URL {
  constructor(input: string, base?: string | URL)
  toString(): string
}

declare function structuredClone<T>(value: T): T
