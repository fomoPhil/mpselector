// MP Selector importer engine. Runs unchanged in a browser page and in Node 20+.
// It reads a firmware's release ZIP and returns the files to put on the card.
// Nothing from the ZIP is ever executed or extracted by path.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

// Streaming SHA-256, so large archives are hashed without loading them whole
// and the page does not depend on WebCrypto being available for file:// pages.
export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.block = new Uint8Array(64);
    this.used = 0;
    this.bytes = 0;
    this.w = new Uint32Array(64);
  }
  compress(data, at) {
    const { h, w } = this;
    for (let i = 0; i < 16; i++, at += 4) {
      w[i] = (data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) +
              w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) +
                  ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) +
                  ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  update(data) {
    let at = 0;
    this.bytes += data.length;
    if (this.used) {
      const take = Math.min(64 - this.used, data.length);
      this.block.set(data.subarray(0, take), this.used);
      this.used += take;
      at = take;
      if (this.used < 64) return this;
      this.compress(this.block, 0);
      this.used = 0;
    }
    for (; at + 64 <= data.length; at += 64) this.compress(data, at);
    this.block.set(data.subarray(at), 0);
    this.used = data.length - at;
    return this;
  }
  hex() {
    const bits = this.bytes * 8;
    const pad = new Uint8Array(((this.used + 9 + 63) & ~63) - this.used);
    pad[0] = 0x80;
    new DataView(pad.buffer).setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    new DataView(pad.buffer).setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    return Array.from(this.h, (v) => v.toString(16).padStart(8, '0')).join('');
  }
}

export const sha256 = (bytes) => new Sha256().update(bytes).hex();

export async function sha256Blob(blob, progress) {
  const hash = new Sha256();
  const step = 8 << 20;
  for (let at = 0; at < blob.size; at += step) {
    hash.update(new Uint8Array(await blob.slice(at, at + step).arrayBuffer()));
    if (progress) progress(Math.min(1, (at + step) / blob.size));
  }
  return hash.hex();
}

let crcTable;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

const text = new TextDecoder();
export const utf8 = (s) => new TextEncoder().encode(s);
export const decode = (bytes) => text.decode(bytes);

async function part(blob, at, size) {
  return new DataView(await blob.slice(at, at + size).arrayBuffer());
}

// A ZIP opened from a Blob. Members are listed from the central directory and
// read one at a time, with size and CRC checked.
export class Zip {
  static async open(blob) {
    const tailSize = Math.min(blob.size, 65557);
    const tail = await part(blob, blob.size - tailSize, tailSize);
    let end = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('That file is not a ZIP.');
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const start = tail.getUint32(end + 16, true);
    if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
      throw new Error('That ZIP is too large for this tool (ZIP64).');
    }
    const dir = await part(blob, start, size);
    const raw = new Uint8Array(dir.buffer);
    const zip = new Zip();
    zip.blob = blob;
    zip.members = new Map();
    for (let at = 0, n = 0; n < count; n++) {
      if (dir.getUint32(at, true) !== 0x02014b50) throw new Error('That ZIP is damaged.');
      const nameSize = dir.getUint16(at + 28, true);
      const name = text.decode(raw.subarray(at + 46, at + 46 + nameSize));
      if (!name.endsWith('/')) {
        zip.members.set(name, {
          name,
          encrypted: !!(dir.getUint16(at + 8, true) & 1),
          method: dir.getUint16(at + 10, true),
          crc: dir.getUint32(at + 16, true),
          packed: dir.getUint32(at + 20, true),
          size: dir.getUint32(at + 24, true),
          at: dir.getUint32(at + 42, true),
        });
      }
      at += 46 + nameSize + dir.getUint16(at + 30, true) + dir.getUint16(at + 32, true);
    }
    return zip;
  }
  names() { return [...this.members.keys()]; }
  has(name) { return this.members.has(name); }
  async read(name) {
    const m = this.members.get(name);
    if (!m) throw new Error(`The ZIP is missing ${name}.`);
    if (m.encrypted) throw new Error(`${name} is password protected.`);
    const head = await part(this.blob, m.at, 30);
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error('That ZIP is damaged.');
    const from = m.at + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const packed = this.blob.slice(from, from + m.packed);
    let bytes;
    if (m.method === 0) {
      bytes = new Uint8Array(await packed.arrayBuffer());
    } else if (m.method === 8) {
      const stream = packed.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`${name} uses a compression this tool cannot read.`);
    }
    if (bytes.length !== m.size || crc32(bytes) !== m.crc) throw new Error(`${name} is damaged in the ZIP.`);
    return bytes;
  }
}

// A stored (uncompressed) ZIP, for browsers that cannot write to a folder.
export function storeZip(files) {
  const parts = [];
  const directory = [];
  let at = 0;
  for (const [path, bytes] of files) {
    const name = utf8(path);
    const head = new DataView(new ArrayBuffer(30));
    const crc = crc32(bytes);
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);
    head.setUint16(12, 0x21, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, bytes.length, true);
    head.setUint32(22, bytes.length, true);
    head.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    new Uint8Array(entry.buffer).set(new Uint8Array(head.buffer, 6, 24), 8);
    entry.setUint32(42, at, true);
    directory.push(entry.buffer, name);
    parts.push(head.buffer, name, bytes);
    at += 30 + name.length + bytes.length;
  }
  const size = directory.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...directory, end.buffer], { type: 'application/zip' });
}

export const COVER_BYTES = 96 * 96 * 2;

// RGBA pixels (96 x 96) to the selector's little-endian RGB565 cover.
export function rgb565(rgba) {
  const out = new Uint8Array(COVER_BYTES);
  for (let i = 0, o = 0; o < COVER_BYTES; i += 4, o += 2) {
    const v = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
    out[o] = v & 255;
    out[o + 1] = v >> 8;
  }
  return out;
}

// The checksum list the selector verifies before it starts an entry.
export function sums(files, folder) {
  const prefix = folder + '/';
  const rows = files
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, bytes]) => `${sha256(bytes)}  ${path.slice(prefix.length)}\n`)
    .sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1));
  return utf8(rows.join(''));
}

export function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}
