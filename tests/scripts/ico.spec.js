import { describe, it, expect } from 'vitest';
import { readIcoFrames, decodeIcoBmp, extractIcoFrame } from '../../scripts/lib/ico.mjs';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Just enough of a PNG for the reader: signature + IHDR width/height.
function fakePng(size) {
  const buf = Buffer.alloc(33);
  Buffer.from(PNG_SIGNATURE).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(size, 16);
  buf.writeUInt32BE(size, 20);
  return buf;
}

// A bottom-up 32bpp BI_RGB icon frame. `pixel(x, y)` returns [r, g, b, a]
// with y counted from the top; `masked(x, y)` sets the AND-mask bit.
function bmpFrame(size, pixel, { masked = () => false, bpp = 32 } = {}) {
  const andStride = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + size * size * 4 + andStride * size);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(bpp, 14);
  buf.writeUInt32LE(0, 16);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = 40 + (row * size + x) * 4;
      buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = a;
      if (masked(x, y)) {
        const m = 40 + size * size * 4 + row * andStride + (x >> 3);
        buf[m] |= 0x80 >> (x & 7);
      }
    }
  }
  return buf;
}

function makeIco(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames.map((f) => f.data)]);
}

describe('readIcoFrames', () => {
  it('lists PNG and BMP frames with their real dimensions (directory byte 0 = 256)', () => {
    const ico = makeIco([
      { size: 16, data: bmpFrame(16, () => [0, 0, 0, 255]) },
      { size: 256, data: fakePng(256) },
    ]);
    const frames = readIcoFrames(ico).map(({ format, width, height }) => ({ format, width, height }));
    expect(frames).toEqual([
      { format: 'bmp', width: 16, height: 16 },
      { format: 'png', width: 256, height: 256 },
    ]);
  });

  it('returns [] for something that is not an icon', () => {
    expect(readIcoFrames(fakePng(32))).toEqual([]);
    expect(readIcoFrames(Buffer.alloc(3))).toEqual([]);
    expect(readIcoFrames(null)).toEqual([]);
  });

  it('skips a directory entry that points past the end of the file', () => {
    const ico = makeIco([{ size: 16, data: bmpFrame(16, () => [0, 0, 0, 255]) }]);
    expect(readIcoFrames(ico.subarray(0, ico.length - 10))).toEqual([]);
  });
});

describe('decodeIcoBmp', () => {
  it('flips bottom-up rows and swaps BGRA to RGBA', () => {
    const frame = bmpFrame(2, (x, y) => (y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128]));
    const { width, height, rgba } = decodeIcoBmp(frame);
    expect([width, height]).toEqual([2, 2]);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);   // top-left: red
    expect(Array.from(rgba.subarray(8, 12))).toEqual([0, 0, 255, 128]);  // bottom-left: blue, half alpha
  });

  it('takes transparency from the AND mask when the alpha bytes are all zero', () => {
    const frame = bmpFrame(2, () => [10, 20, 30, 0], { masked: (x) => x === 1 });
    const { rgba } = decodeIcoBmp(frame);
    expect(rgba[3]).toBe(255);   // (0,0) unmasked → opaque
    expect(rgba[7]).toBe(0);     // (1,0) masked → transparent
  });

  it('refuses depths it does not decode', () => {
    expect(decodeIcoBmp(bmpFrame(2, () => [0, 0, 0, 255], { bpp: 24 }))).toBeNull();
  });
});

describe('extractIcoFrame', () => {
  it('prefers a PNG frame at the requested size, returned byte-for-byte', () => {
    const png = fakePng(256);
    const ico = makeIco([{ size: 256, data: bmpFrame(256, () => [0, 0, 0, 255]) }, { size: 256, data: png }]);
    const frame = extractIcoFrame(ico, 256);
    expect(frame.format).toBe('png');
    expect(frame.data.equals(png)).toBe(true);
  });

  it('decodes a BMP frame at the requested size', () => {
    const ico = makeIco([{ size: 256, data: bmpFrame(256, () => [1, 2, 3, 255]) }]);
    const frame = extractIcoFrame(ico, 256);
    expect(frame.format).toBe('rgba');
    expect([frame.width, frame.height, frame.rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
  });

  it('returns null rather than upscaling when no frame is that size', () => {
    const ico = makeIco([
      { size: 64, data: fakePng(64) },
      { size: 32, data: bmpFrame(32, () => [0, 0, 0, 255]) },
    ]);
    expect(extractIcoFrame(ico, 256)).toBeNull();
  });
});
