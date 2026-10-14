import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length);
  Buffer.from(type).copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), data.length + 8);
  return result;
}
export function authoredPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const offset = y * (1 + width * 4) + 1 + x * 4; pixels[offset] = 17; pixels[offset + 1] = 83; pixels[offset + 2] = 191; pixels[offset + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
/** Baseline grayscale JPEG: every 8×8 block has DC=0/AC=EOB, decoding to constant 128. */
export function authoredJpeg(width: number, height: number): Buffer {
  const segment = (marker: number, data: Buffer) => { const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2); return Buffer.concat([header, data]); };
  const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 17, 0]); frame.writeUInt16BE(height, 1); frame.writeUInt16BE(width, 3);
  const huffman = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(15), Buffer.from([0, 16, 1]), Buffer.alloc(15), Buffer.from([0])]);
  const bits = Math.ceil(width / 8) * Math.ceil(height / 8) * 2;
  const entropy = Buffer.alloc(Math.ceil(bits / 8)); if (bits % 8) entropy[entropy.length - 1] = (1 << (8 - bits % 8)) - 1;
  return Buffer.concat([Buffer.from([255, 216]), segment(219, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])), segment(192, frame), segment(196, huffman), segment(218, Buffer.from([1, 1, 0, 0, 63, 0])), entropy, Buffer.from([255, 217])]);
}
