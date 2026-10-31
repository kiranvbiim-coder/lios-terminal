import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Decode only static 8-bit RGB/RGBA PNGs, with bounded dimensions and inflate output. */
export function fitGeneratedPng(bytes: Buffer, maxBytes = 700_000): Buffer {
  if (bytes.length > 24 * 1024 * 1024 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("The provider did not return a supported PNG image.");
  let width = 0, height = 0, channels = 0, ended = false;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) throw new Error("Incomplete image from the provider.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (crc(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) throw new Error("Damaged image from the provider.");
    if (!width && type !== "IHDR") throw new Error("Invalid image header.");
    if (type === "IHDR") {
      if (width || size !== 13 || data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) throw new Error("Unsupported image encoding from the provider.");
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3;
      if (!width || !height || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) throw new Error("The generated image exceeds the size limit.");
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") { if (size || offset + 12 !== bytes.length) throw new Error("Invalid image ending."); ended = true; break; }
    else if (["acTL", "fcTL", "fdAT"].includes(type) || (type[0] === type[0].toUpperCase() && type !== "PLTE")) throw new Error("Unsupported image encoding from the provider.");
    offset += size + 12;
  }
  if (!ended || !compressed.length) throw new Error("Incomplete image from the provider.");
  const stride = width * channels, expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("Invalid image pixels.");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Invalid image filter.");
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= channels ? pixels[at - channels] : 0;
      const b = y ? pixels[at - stride] : 0, c = y && x >= channels ? pixels[at - stride - channels] : 0;
      pixels[at] = (raw[y * (stride + 1) + x + 1] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  for (let scale = 1; ; scale *= 0.75) {
    const w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    const rows = Buffer.alloc((w * channels + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const from = (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * channels;
      pixels.copy(rows, y * (w * channels + 1) + 1 + x * channels, from, from + channels);
    }
    const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = channels === 4 ? 6 : 2;
    const result = Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
    if (result.length <= maxBytes) return result;
    if (w === 1 && h === 1) throw new Error("Image storage limit is too small.");
  }
}
