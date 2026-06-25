/*******************************************************************************
 * Ethereals N ADS — icon generator (zero deps)
 *
 * Draws a two-tone shield at each size with 4x supersampling and writes
 * valid PNGs (IHDR/IDAT/IEND with CRC32, zlib-deflated scanlines).
 *
 * Part of Ethereals N ADS, licensed GPL-3.0.
 ******************************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// shield outline in unit coords (0..1), y down
const SHIELD = [
    [0.5, 0.04],
    [0.94, 0.16], [0.94, 0.52],
    [0.5, 0.97],
    [0.06, 0.52], [0.06, 0.16],
];

function pointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function crc32(buf) {
    let c;
    const table = crc32.table || (crc32.table = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            t[n] = c >>> 0;
        }
        return t;
    })());
    c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        const row = y * (size * 4 + 1);
        raw[row] = 0; // filter none
        pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// brand colors
const TOP = [0x1a, 0x8f, 0xff];   // bright azure
const BOTTOM = [0x0b, 0x3f, 0x9e]; // deep blue
const EDGE = [0xff, 0xff, 0xff];   // white rim

function renderShield(size) {
    const S = 4; // supersample
    const px = Buffer.alloc(size * size * 4);
    const rim = Math.max(size / 16, 1);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = 0; sy < S; sy++) {
                for (let sx = 0; sx < S; sx++) {
                    const u = (x + (sx + 0.5) / S) / size;
                    const v = (y + (sy + 0.5) / S) / size;
                    // distance-ish measure from edge via horizontal span test
                    const inside = pointInPolygon(u, v, SHIELD);
                    if (!inside) { continue; }
                    // rim: near the outline → white
                    const probe = 0.035;
                    const nearEdge =
                        !pointInPolygon(u - probe, v, SHIELD) ||
                        !pointInPolygon(u + probe, v, SHIELD) ||
                        !pointInPolygon(u, v - probe, SHIELD) ||
                        !pointInPolygon(u, v + probe, SHIELD);
                    let cr, cg, cb;
                    if (nearEdge && size >= rim) {
                        [cr, cg, cb] = EDGE;
                    } else {
                        const t = (v - 0.04) / 0.93;
                        cr = Math.round(lerp(TOP[0], BOTTOM[0], t));
                        cg = Math.round(lerp(TOP[1], BOTTOM[1], t));
                        cb = Math.round(lerp(TOP[2], BOTTOM[2], t));
                    }
                    r += cr; g += cg; b += cb; a += 255;
                }
            }
            const n = S * S;
            const i = (y * size + x) * 4;
            px[i] = Math.round(r / (a ? n : 1) || 0);
            px[i + 1] = Math.round(g / (a ? n : 1) || 0);
            px[i + 2] = Math.round(b / (a ? n : 1) || 0);
            px[i + 3] = Math.round(a / n);
        }
    }
    return px;
}

export async function generateIcons(outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const size of [16, 32, 64, 128]) {
        const png = encodePNG(size, renderShield(size));
        fs.writeFileSync(path.join(outDir, `icon_${size}.png`), png);
    }
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
    const out = process.argv[2] || 'src/img';
    generateIcons(path.resolve(out)).then(() =>
        console.log(`icons → ${out}`));
}
