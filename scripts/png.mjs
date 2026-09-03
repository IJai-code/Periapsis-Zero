import zlib from 'node:zlib'
const CRC = (() => { const t = new Int32Array(256)
  for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c}
  return (b)=>{let c=-1;for(let i=0;i<b.length;i++)c=t[(c^b[i])&0xff]^(c>>>8);return (c^-1)>>>0} })()
function chunk(type, data){ const len=Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td=Buffer.concat([Buffer.from(type,'ascii'),data]); const crc=Buffer.alloc(4); crc.writeUInt32BE(CRC(td))
  return Buffer.concat([len,td,crc]) }
/** rgba: Uint8Array length w*h*4 */
export function encodePNG(rgba, w, h){
  const raw = Buffer.alloc(h*(w*4+1))
  for(let y=0;y<h;y++){ raw[y*(w*4+1)] = 0; Buffer.from(rgba.buffer,rgba.byteOffset+y*w*4,w*4).copy(raw, y*(w*4+1)+1) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4)
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr),
    chunk('IDAT', zlib.deflateSync(raw,{level:6})), chunk('IEND',Buffer.alloc(0))])
}
/** Nearest-neighbour downscale, and flip vertically so row 0 (south) ends up at the bottom. */
export function preview(buf, w, h, outW){
  const s = w/outW, outH = Math.round(h/s), o = new Uint8Array(outW*outH*4)
  for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
    const sy = h-1-Math.min(h-1,Math.floor(y*s)), sx = Math.min(w-1,Math.floor(x*s))
    const si=(sy*w+sx)*4, di=(y*outW+x)*4
    o[di]=buf[si];o[di+1]=buf[si+1];o[di+2]=buf[si+2];o[di+3]=buf[si+3] }
  return { data:o, w:outW, h:outH }
}

/* ------------------------------------------------------------------ *
 * Decoding. Needed because the NASA lunar displacement map ships as a
 * 16-bit TIFF: sips can transcode it to PNG, but nothing in Node can
 * read the pixels back out again.
 * ------------------------------------------------------------------ */

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Reverse one scanline filter, in place. */
function unfilter(type, cur, prev, bpp) {
  const n = cur.length
  switch (type) {
    case 0:
      break
    case 1:
      for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff
      break
    case 2:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 0xff
      break
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff
      }
      break
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        const c = i >= bpp ? prev[i - bpp] : 0
        cur[i] = (cur[i] + paeth(a, prev[i], c)) & 0xff
      }
      break
    default:
      throw new Error(`unknown PNG filter ${type}`)
  }
}

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported')
      if (colorType === 3) throw new Error('palette PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    pos += 12 + len
  }

  const channels = CHANNELS[colorType]
  const sample = bitDepth === 16 ? 2 : 1
  const bpp = channels * sample
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(height * stride)

  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    raw.copy(out, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    unfilter(filter, cur, prev, bpp)
    prev = cur
  }
  return { width, height, channels, bitDepth, data: out }
}

/** First channel of a decoded PNG, normalised to 0..1. */
export function toGray({ width, height, channels, bitDepth, data }) {
  const out = new Float32Array(width * height)
  const sample = bitDepth === 16 ? 2 : 1
  for (let i = 0; i < out.length; i++) {
    const o = i * channels * sample
    out[i] = bitDepth === 16 ? (data[o] * 256 + data[o + 1]) / 65535 : data[o] / 255
  }
  return out
}

export function hasAlpha({ channels }) {
  return channels === 2 || channels === 4
}

/**
 * Header-level inspection: size, colour type, and whether the file carries
 * alpha at all. Covers the palette + tRNS case, which is real alpha but is not
 * reachable through the pixel decoder above.
 */
export function pngInfo(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let info = { width: 0, height: 0, bitDepth: 8, colorType: 6, tRNS: false }
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    if (type === 'IHDR') {
      const d = buf.subarray(pos + 8, pos + 8 + len)
      info.width = d.readUInt32BE(0)
      info.height = d.readUInt32BE(4)
      info.bitDepth = d[8]
      info.colorType = d[9]
    } else if (type === 'tRNS') {
      info.tRNS = true
    } else if (type === 'IEND') break
    pos += 12 + len
  }
  // 4 = grey+alpha, 6 = RGBA, 3 + tRNS = palette with per-entry alpha
  info.hasAlpha = info.colorType === 4 || info.colorType === 6 || (info.colorType === 3 && info.tRNS)
  return info
}
