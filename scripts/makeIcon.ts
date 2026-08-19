/**
 * Generates `build/icon.ico` (and a PNG next to it) for the desktop build.
 *
 * Written by hand rather than pulled from a design tool so the icon is
 * reproducible from source and the repo stays free of binary blobs nobody can
 * regenerate. It draws the thing the app is actually about: a five-node
 * prerequisite graph, in the same status colours the tree uses.
 *
 *   npm run icon
 *
 * Rendered at 4× and box-downsampled — that is the whole anti-aliasing story,
 * and it is cheaper than carrying a canvas dependency for one 256px image.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SS = 4; // supersample factor
const W = SIZE * SS;

type RGB = [number, number, number];

const BG: RGB = [0x1c, 0x1f, 0x26]; // --color-surface
const EDGE: RGB = [0x3a, 0x40, 0x50];
const COMPLETED: RGB = [0x34, 0xd3, 0x99];
const PLANNED: RGB = [0x4f, 0x8c, 0xff];
const AVAILABLE: RGB = [0xfb, 0xbf, 0x24];
const LOCKED: RGB = [0x6b, 0x72, 0x80];

const buf = new Uint8ClampedArray(W * W * 4); // transparent

function put(x: number, y: number, c: RGB, a: number) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  const dstA = buf[i + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  for (let k = 0; k < 3; k++)
    buf[i + k] = (c[k] * a + buf[i + k] * dstA * (1 - a)) / outA;
  buf[i + 3] = outA * 255;
}

/** Rounded rectangle, in 256-space. */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB) {
  const s = SS;
  for (let y = Math.floor(y0 * s); y < Math.ceil(y1 * s); y++)
    for (let x = Math.floor(x0 * s); x < Math.ceil(x1 * s); x++) {
      const px = x / s;
      const py = y / s;
      const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
      const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
      if (Math.hypot(dx, dy) <= r) put(x, y, c, 1);
    }
}

function disc(cx: number, cy: number, r: number, c: RGB) {
  const s = SS;
  for (let y = Math.floor((cy - r) * s); y <= Math.ceil((cy + r) * s); y++)
    for (let x = Math.floor((cx - r) * s); x <= Math.ceil((cx + r) * s); x++)
      if (Math.hypot(x / s - cx, y / s - cy) <= r) put(x, y, c, 1);
}

function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  c: RGB,
) {
  const s = SS;
  const half = w / 2;
  const minX = Math.floor((Math.min(x0, x1) - half) * s);
  const maxX = Math.ceil((Math.max(x0, x1) + half) * s);
  const minY = Math.floor((Math.min(y0, y1) - half) * s);
  const maxY = Math.ceil((Math.max(y0, y1) + half) * s);
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x / s - x0;
      const py = y / s - y0;
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / len2));
      if (Math.hypot(px - t * vx, py - t * vy) <= half) put(x, y, c, 1);
    }
}

// ---------------------------------------------------------------- the icon

roundRect(6, 6, 250, 250, 52, BG);

// Two prerequisites feeding a gate course, which unlocks two more. The shape
// of every question this app answers.
const N: Record<string, [number, number]> = {
  a: [76, 80],
  b: [76, 176],
  gate: [128, 128],
  c: [180, 80],
  d: [180, 176],
};
for (const [from, to] of [
  ["a", "gate"],
  ["b", "gate"],
  ["gate", "c"],
  ["gate", "d"],
] as const)
  line(N[from][0], N[from][1], N[to][0], N[to][1], 9, EDGE);

disc(...N.a, 21, COMPLETED);
disc(...N.b, 21, COMPLETED);
disc(...N.gate, 26, PLANNED);
disc(...N.c, 21, AVAILABLE);
disc(...N.d, 21, LOCKED);

// ------------------------------------------------------------- downsample

const out = new Uint8ClampedArray(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + x * SS + sx) * 4;
        const al = buf[i + 3] / 255;
        r += buf[i] * al;
        g += buf[i + 1] * al;
        b += buf[i + 2] * al;
        a += al;
      }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = a > 0 ? r / a : 0;
    out[o + 1] = a > 0 ? g / a : 0;
    out[o + 2] = a > 0 ? b / a : 0;
    out[o + 3] = (a / n) * 255;
  }

// -------------------------------------------------------------- PNG + ICO

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (b: Buffer) => {
    let c = -1;
    for (const byte of b) c = t[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(pixels: Uint8ClampedArray, size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO with a single PNG-compressed 256×256 image — allowed since Vista. */
function ico(pngData: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 0 means 256
  entry[1] = 0;
  entry[2] = 0; // truecolour palette
  entry[4] = 1; // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([head, entry, pngData]);
}

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "..", "build");
mkdirSync(dir, { recursive: true });
const data = png(out, SIZE);
writeFileSync(resolve(dir, "icon.png"), data);
writeFileSync(resolve(dir, "icon.ico"), ico(data));
console.log(`build/icon.ico — ${(ico(data).length / 1024).toFixed(1)} kB`);
