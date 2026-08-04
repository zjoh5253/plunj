/**
 * Minimal self-contained QR code generator rendered as inline SVG. No external
 * services (desk tablets must work with zero third-party requests). Byte mode,
 * error-correction level M, versions 1–6 (up to 106 bytes) — plenty for the
 * short walk-in / waiver URLs the desk shows. Fixed mask pattern 0 (readers
 * decode any mask; the mask id is carried in the format info).
 */

// --- GF(256) arithmetic (polynomial 0x11d) for Reed–Solomon ----------------

const EXP = new Uint8Array(255)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
}

function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0
}

/** Generator polynomial coefficients for `degree` EC codewords. */
function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gmul(result[j] ?? 0, root) ^ (j + 1 < degree ? (result[j + 1] ?? 0) : 0)
    }
    root = gmul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length)
  for (const b of data) {
    const factor = b ^ (result[0] ?? 0)
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] = (result[i] ?? 0) ^ gmul(divisor[i] ?? 0, factor)
    }
  }
  return result
}

// --- Version table, error level M, versions 1–6 ----------------------------

interface VersionSpec {
  version: number
  blocks: number
  dataPerBlock: number
  ecPerBlock: number
  /** Second alignment-pattern center coordinate (0 = none, version 1). */
  align: number
}

const VERSIONS: VersionSpec[] = [
  { version: 1, blocks: 1, dataPerBlock: 16, ecPerBlock: 10, align: 0 },
  { version: 2, blocks: 1, dataPerBlock: 28, ecPerBlock: 16, align: 18 },
  { version: 3, blocks: 1, dataPerBlock: 44, ecPerBlock: 26, align: 22 },
  { version: 4, blocks: 2, dataPerBlock: 32, ecPerBlock: 18, align: 26 },
  { version: 5, blocks: 2, dataPerBlock: 43, ecPerBlock: 24, align: 30 },
  { version: 6, blocks: 4, dataPerBlock: 27, ecPerBlock: 16, align: 34 },
]

// --- Matrix construction ---------------------------------------------------

interface Matrix {
  size: number
  dark: boolean[][]
  isFunction: boolean[][]
}

function setFunction(m: Matrix, x: number, y: number, dark: boolean): void {
  const row = m.dark[y]
  const fnRow = m.isFunction[y]
  if (row && fnRow) {
    row[x] = dark
    fnRow[x] = true
  }
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || x >= m.size || y < 0 || y >= m.size) continue
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(m, x, y, dist !== 2 && dist !== 4)
    }
  }
}

function drawAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

/** 15-bit format info for EC level M + the given mask, BCH-coded and masked. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask // 'M' EC-level indicator is 00
  let rem = data
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  }
  return ((data << 10) | rem) ^ 0x5412
}

function drawFormat(m: Matrix, mask: number): void {
  const bits = formatBits(mask)
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0
  // Copy around the top-left finder
  for (let i = 0; i <= 5; i += 1) setFunction(m, 8, i, bit(i))
  setFunction(m, 8, 7, bit(6))
  setFunction(m, 8, 8, bit(7))
  setFunction(m, 7, 8, bit(8))
  for (let i = 9; i < 15; i += 1) setFunction(m, 14 - i, 8, bit(i))
  // Second copy split between the other two finders
  for (let i = 0; i <= 7; i += 1) setFunction(m, m.size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i += 1) setFunction(m, 8, m.size - 15 + i, bit(i))
  setFunction(m, 8, m.size - 8, true) // dark module
}

/** Encode `text` (UTF-8, byte mode, level M) into a module matrix. */
export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  const spec = VERSIONS.find((v) => bytes.length <= v.blocks * v.dataPerBlock - 2)
  if (!spec) throw new Error(`QR payload too long (${bytes.length} bytes, max 106)`)
  const totalData = spec.blocks * spec.dataPerBlock

  // Bit stream: mode 0100, 8-bit length, data, terminator, pads.
  const bits: number[] = []
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, totalData * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j += 1) b = (b << 1) | (bits[i + j] ?? 0)
    codewords.push(b)
  }
  for (let pad = 0xec; codewords.length < totalData; pad ^= 0xec ^ 0x11) {
    codewords.push(pad)
  }

  // Split into blocks (uniform for M v1–6), append EC, interleave.
  const divisor = rsDivisor(spec.ecPerBlock)
  const dataBlocks: number[][] = []
  const ecBlocks: Uint8Array[] = []
  for (let b = 0; b < spec.blocks; b += 1) {
    const block = codewords.slice(b * spec.dataPerBlock, (b + 1) * spec.dataPerBlock)
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, divisor))
  }
  const stream: number[] = []
  for (let i = 0; i < spec.dataPerBlock; i += 1) {
    for (const block of dataBlocks) stream.push(block[i] ?? 0)
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) stream.push(block[i] ?? 0)
  }

  // Function patterns
  const size = 17 + 4 * spec.version
  const m: Matrix = {
    size,
    dark: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    isFunction: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  }
  for (let i = 0; i < size; i += 1) {
    setFunction(m, 6, i, i % 2 === 0)
    setFunction(m, i, 6, i % 2 === 0)
  }
  drawFinder(m, 3, 3)
  drawFinder(m, size - 4, 3)
  drawFinder(m, 3, size - 4)
  if (spec.align > 0) drawAlignment(m, spec.align, spec.align)
  drawFormat(m, 0)

  // Zigzag data placement, MSB first, then mask 0 on non-function modules.
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        const fnRow = m.isFunction[y]
        const row = m.dark[y]
        if (!fnRow || !row || fnRow[x]) continue
        let dark = false
        if (bitIndex < stream.length * 8) {
          dark = (((stream[bitIndex >> 3] ?? 0) >>> (7 - (bitIndex & 7))) & 1) !== 0
          bitIndex += 1
        }
        if ((x + y) % 2 === 0) dark = !dark // mask pattern 0
        row[x] = dark
      }
    }
  }
  return m.dark
}

// --- SVG component ---------------------------------------------------------

const QUIET = 4

export function QrSvg({
  value,
  className = '',
  label,
}: {
  value: string
  className?: string
  label?: string
}) {
  const modules = encodeQr(value)
  const size = modules.length
  let d = ''
  for (let y = 0; y < size; y += 1) {
    const row = modules[y]
    if (!row) continue
    for (let x = 0; x < size; x += 1) {
      if (row[x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`
    }
  }
  const total = size + QUIET * 2
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      className={className}
      role="img"
      aria-label={label ?? 'QR code'}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill="#0a0a0a" />
    </svg>
  )
}
