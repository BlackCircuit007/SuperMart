// Generates all LordTempsMart brand images using only Node built-ins.
// Sharp, anti-aliased art: gradient orange tile + white shopping-bag glyph.
//
// Outputs:
//   frontend/icons/icon-192.png            (PWA any)
//   frontend/icons/icon-512.png            (PWA any)
//   frontend/icons/icon-512-maskable.png   (PWA maskable)
//   frontend/icons/logo-1024.png           (Electron splash / branding)
//   build/icon.ico                         (Windows app icon — 256px PNG-in-ICO)
//   build/icon.png                         (electron-builder fallback icon)
//
// Run:  node generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG encoding ----------
const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- ICO encoding (embeds a PNG — valid on Windows Vista+) ----------
function encodeIco(pngBuffers) {
    // pngBuffers: [{ size, data }] — size must be <= 256
    const count = pngBuffers.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);      // reserved
    header.writeUInt16LE(1, 2);      // type: icon
    header.writeUInt16LE(count, 4);  // image count
    const entries = [];
    let offset = 6 + count * 16;
    for (const img of pngBuffers) {
        const e = Buffer.alloc(16);
        e[0] = img.size >= 256 ? 0 : img.size; // 0 means 256
        e[1] = img.size >= 256 ? 0 : img.size;
        e[2] = 0;  // palette colors
        e[3] = 0;  // reserved
        e.writeUInt16LE(1, 4);             // planes
        e.writeUInt16LE(32, 6);            // bit depth
        e.writeUInt32LE(img.data.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += img.data.length;
        entries.push(e);
    }
    return Buffer.concat([header, ...entries, ...pngBuffers.map(i => i.data)]);
}

// ---------- Art ----------
const GRAD_TOP = [255, 106, 69];   // #FF6A45
const GRAD_BOT = [230, 46, 0];     // #E62E00
const WHITE = [255, 255, 255];

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function insideRounded(x, y, S, r) {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    const cx = Math.min(Math.max(x, r), S - r);
    const cy = Math.min(Math.max(y, r), S - r);
    const dx = x - cx, dy = y - cy;
    return (dx * dx + dy * dy) <= r * r;
}

// White shopping-bag glyph. Coordinates in [0,S).
function insideBag(px, py, S) {
    // Body: trapezoid, slightly wider at the bottom
    const topY = 0.44 * S, botY = 0.76 * S;
    if (py >= topY && py <= botY) {
        const t = (py - topY) / (botY - topY);
        const xl = (0.315 + (0.27 - 0.315) * t) * S;
        const xr = (0.685 + (0.73 - 0.685) * t) * S;
        if (px >= xl && px <= xr) return true;
    }
    // Handle: ring above the body
    const hx = 0.5 * S, hy = 0.46 * S;
    const dx = px - hx, dy = py - hy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0.125 * S && d >= 0.072 * S && py <= 0.495 * S) return true;
    return false;
}

// Soft shadow ellipse under the bag (drawn on the tile, under the bag).
function shadowAlpha(px, py, S) {
    const cx = 0.5 * S, cy = 0.795 * S;
    const rx = 0.26 * S, ry = 0.035 * S;
    const dx = (px - cx) / rx, dy = (py - cy) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= 1) return 0;
    return Math.round(70 * (1 - d)); // up to ~27% opacity black
}

function makeIcon(S, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;
    const scale = opts.scale || 1;
    const radius = rounded ? 0.22 * S : 0;
    const buf = Buffer.alloc(S * S * 4);
    const SS = opts.ss || 4; // supersampling grid per axis

    for (let y = 0; y < S; y++) {
        // vertical gradient color for this row (sample at row center)
        const gt = y / (S - 1);
        const gr = lerp(GRAD_TOP[0], GRAD_BOT[0], gt);
        const gg = lerp(GRAD_TOP[1], GRAD_BOT[1], gt);
        const gb = lerp(GRAD_TOP[2], GRAD_BOT[2], gt);

        for (let x = 0; x < S; x++) {
            let bgCount = 0, fgCount = 0, shCount = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const fx = x + (sx + 0.5) / SS;
                    const fy = y + (sy + 0.5) / SS;
                    let inBg = rounded ? insideRounded(fx, fy, S, radius) : true;
                    if (!inBg) continue;
                    bgCount++;
                    const px = (fx - S / 2) / scale + S / 2;
                    const py = (fy - S / 2) / scale + S / 2;
                    if (insideBag(px, py, S)) fgCount++;
                    else if (shadowAlpha(px, py, S) > 0) shCount++;
                }
            }
            const i = (y * S + x) * 4;
            if (bgCount === 0) { buf[i + 3] = 0; continue; }

            let r = gr, g = gg, b = gb;
            if (shCount > 0) { // blend soft black shadow into the tile
                const sa = shCount / bgCount;
                r = Math.round(r * (1 - sa));
                g = Math.round(g * (1 - sa));
                b = Math.round(b * (1 - sa));
            }
            if (fgCount > 0) { // white bag on top
                const fa = fgCount / bgCount;
                r = lerp(r, WHITE[0], fa);
                g = lerp(g, WHITE[1], fa);
                b = lerp(b, WHITE[2], fa);
            }
            buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
        }
    }
    return encodePng(S, S, buf);
}

// ---------- Write outputs ----------
const root = __dirname;
const iconsDir = path.join(root, 'frontend', 'icons');
const buildDir = path.join(root, 'build');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

const jobs = [
    { file: path.join(iconsDir, 'icon-192.png'), size: 192, opts: {} },
    { file: path.join(iconsDir, 'icon-512.png'), size: 512, opts: {} },
    { file: path.join(iconsDir, 'icon-512-maskable.png'), size: 512, opts: { rounded: false, scale: 0.82 } },
    { file: path.join(iconsDir, 'logo-1024.png'), size: 1024, opts: { ss: 3 } },
    { file: path.join(buildDir, 'icon.png'), size: 512, opts: {} }
];

for (const j of jobs) {
    const png = makeIcon(j.size, j.opts);
    fs.writeFileSync(j.file, png);
    console.log('wrote ' + path.relative(root, j.file) + ' (' + png.length + ' bytes)');
}

// Windows .ico with the 256px render (crisp in Explorer/taskbar)
const ico256 = makeIcon(256, {});
const ico = encodeIco([{ size: 256, data: ico256 }]);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
console.log('wrote build/icon.ico (' + ico.length + ' bytes)');
console.log('DONE');