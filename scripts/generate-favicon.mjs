/**
 * Generates public/favicon.ico from a source PNG using sharp.
 * ICO files are just a thin wrapper around a PNG/BMP payload;
 * modern browsers handle PNG-inside-ICO perfectly.
 *
 * Usage: node scripts/generate-favicon.mjs
 */

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root      = resolve(__dirname, '..')

const src  = resolve(root, 'public/WFA-Submarks-Combo-05.png')
const dest = resolve(root, 'public/favicon.ico')

// Build 16×16, 32×32, and 48×48 PNG buffers
const sizes = [16, 32, 48]
const pngBuffers = await Promise.all(
  sizes.map(s => sharp(src).resize(s, s, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } }).png().toBuffer())
)

// ── Encode as ICO ────────────────────────────────────────────────────────────
// ICO format reference: https://en.wikipedia.org/wiki/ICO_(file_format)

const numImages = pngBuffers.length
const HEADER_SIZE  = 6                     // ICONDIR
const ENTRY_SIZE   = 16                    // ICONDIRENTRY per image
const dataOffset   = HEADER_SIZE + ENTRY_SIZE * numImages

// ICONDIR
const header = Buffer.alloc(HEADER_SIZE)
header.writeUInt16LE(0, 0)           // reserved
header.writeUInt16LE(1, 2)           // type: 1 = ICO
header.writeUInt16LE(numImages, 4)   // image count

// Build entries + collect payloads
const entries  = []
const payloads = []
let offset = dataOffset

for (let i = 0; i < numImages; i++) {
  const buf  = pngBuffers[i]
  const size = sizes[i]
  const entry = Buffer.alloc(ENTRY_SIZE)
  entry.writeUInt8(size === 256 ? 0 : size, 0)   // width  (0 = 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1)   // height (0 = 256)
  entry.writeUInt8(0, 2)                          // color count (0 = no palette)
  entry.writeUInt8(0, 3)                          // reserved
  entry.writeUInt16LE(1, 4)                       // color planes
  entry.writeUInt16LE(32, 6)                      // bits per pixel
  entry.writeUInt32LE(buf.length, 8)              // image data size
  entry.writeUInt32LE(offset, 12)                 // offset to image data
  entries.push(entry)
  payloads.push(buf)
  offset += buf.length
}

const ico = Buffer.concat([header, ...entries, ...payloads])
writeFileSync(dest, ico)
console.log(`✔ favicon.ico written (${sizes.join('×, ')}×) → ${dest}`)
