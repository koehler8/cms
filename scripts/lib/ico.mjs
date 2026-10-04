// Minimal .ico reader for cms-generate-public-assets.
//
// The script needs one thing from a site-provided favicon.ico: its 256px
// frame, to publish as the Web App Manifest's /favicon-256.png. canvas can't
// load .ico at all, so this lists the frames and decodes the 32-bit BMP ones
// (what most encoders write); PNG-embedded frames are returned as-is.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(data) {
  return data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * List a .ico's frames. Dimensions come from the frame itself (PNG IHDR or
 * BMP header), not the directory entry, whose single byte can't say 256+.
 * Returns [] for anything that isn't a well-formed icon file.
 */
export function readIcoFrames(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return [];
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return [];
  const count = buf.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i;
    if (entry + 16 > buf.length) break;
    const size = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    if (!size || offset + size > buf.length) continue;
    const data = buf.subarray(offset, offset + size);
    if (isPng(data)) {
      frames.push({ format: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20), data });
    } else if (data.length >= 40) {
      // BMP frames store the XOR image and the AND mask stacked, so the
      // header height is double the icon's.
      frames.push({
        format: 'bmp',
        width: data.readInt32LE(4),
        height: Math.abs(data.readInt32LE(8)) / 2,
        data,
      });
    }
  }
  return frames;
}

/**
 * Decode a 32bpp uncompressed BMP icon frame to straight RGBA. Returns null
 * for any other depth or compression — those are rare enough in practice
 * that the caller falls back to another source rather than decoding them.
 */
export function decodeIcoBmp(data) {
  if (!data || data.length < 40) return null;
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const rawHeight = data.readInt32LE(8);
  const bpp = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (bpp !== 32 || compression !== 0 || width <= 0 || rawHeight === 0) return null;

  const height = Math.abs(rawHeight) / 2;
  const bottomUp = rawHeight > 0;
  const xorStride = width * 4;
  const andStride = Math.ceil(width / 32) * 4;
  const andStart = headerSize + xorStride * height;
  if (!Number.isInteger(height) || andStart > data.length) return null;
  const hasAndMask = andStart + andStride * height <= data.length;

  const rgba = new Uint8ClampedArray(width * height * 4);
  let usesAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const s = headerSize + row * xorStride + x * 4;
      const d = (y * width + x) * 4;
      rgba[d] = data[s + 2];
      rgba[d + 1] = data[s + 1];
      rgba[d + 2] = data[s];
      rgba[d + 3] = data[s + 3];
      if (data[s + 3]) usesAlpha = true;
    }
  }

  // Older encoders leave the alpha byte at 0 and carry transparency in the
  // 1-bit AND mask alone; reading the zeros literally would blank the icon.
  if (!usesAlpha) {
    for (let y = 0; y < height; y++) {
      const row = bottomUp ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const masked = hasAndMask
          && (data[andStart + row * andStride + (x >> 3)] >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = masked ? 0 : 255;
      }
    }
  }

  return { width, height, rgba };
}

/**
 * The icon's square frame at exactly `size` px, ready to write:
 *   { format: 'png', data }            — a PNG frame, byte-for-byte
 *   { format: 'rgba', width, height, rgba } — a decoded BMP frame
 * or null when the icon has no usable frame at that size (upscaling a
 * 64px favicon would only publish a blurry icon under a 256px label).
 */
export function extractIcoFrame(buf, size) {
  const frames = readIcoFrames(buf).filter((f) => f.width === size && f.height === size);
  const png = frames.find((f) => f.format === 'png');
  if (png) return { format: 'png', data: png.data };
  for (const frame of frames) {
    const decoded = decodeIcoBmp(frame.data);
    if (decoded) return { format: 'rgba', ...decoded };
  }
  return null;
}
