import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as zlib from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'public', 'icons')

mkdirSync(iconsDir, { recursive: true })

const sizes = [16, 32, 48, 128]

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeB = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeB, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcData))
  return Buffer.concat([len, typeB, data, crc])
}

function createPNG(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rawData = []
  for (let y = 0; y < size; y++) {
    rawData.push(0)
    for (let x = 0; x < size; x++) {
      rawData.push(0x18)
      rawData.push(0x77)
      rawData.push(0xF2)
    }
  }

  const raw = Buffer.from(rawData)
  const compressed = zlib.deflateSync(raw)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of sizes) {
  const png = createPNG(size)
  writeFileSync(resolve(iconsDir, `icon${size}.png`), png)
  console.log(`Generated icon${size}.png (${size}x${size})`)
}
