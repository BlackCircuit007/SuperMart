// Generates PWA icons (PNG) for LordTempsMart using only Node built-ins.
// Art: brand-orange rounded square with a white shopping-bag glyph.
// Run once:  node generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- PNG encoding -------------------------------------------------------
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
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type RGBA
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Icon art -----------------------------------------------------------
const BG = [255, 59, 32];     // brand orange-red
const FG = [255, 255, 255];   // white bag

function insideRounded(x, y, S, r) {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    const cx = Math.min(Math.max(x, r), S - r);
    const cy = Math.min(Math.max(y, r), S - r);
    const dx = x - cx, dy = y - cy;
    return (dx * dx + dy * dy) <= r * r;
}

// Is point inside the white shopping-bag art? Coordinates in [0,S).
function insideBag(px, py, S) {
    // Bag body: trapezoid (slightly wider at the bottom)
    const topY = 0.44 * S, botY = 0.76 * S;
    if (py >= topY && py <= botY) {
        const t = (py - topY) / (botY - topY);
        const xl = (0.315 + (0.27 - 0.315) * t) * S;
        const xr = (0.685 + (0.73 - 0.685) * t) * S;
        if (px >= xl && px <= xr) return true;
    }
    // Handle: ring above the bag body
    const hx = 0.5 * S, hy = 0.46 * S;
    const dx = px - hx, dy = py - hy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0.125 * S && d >= 0.07 * S && py <= 0.49 * S) return true;
    return false;
}

function makeIcon(S, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;
    const scale = opts.scale || 1;      // shrink art toward center (maskable safe zone)
    const radius = rounded ? 0.22 * S : 0;
    const buf = Buffer.alloc(S * S * 4);
    const SS = 3; // 3x3 supersampling for smooth edges

    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            let bgCount = 0, fgCount = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const fx = x + (sx + 0.5) / SS;
                    const fy = y + (sy + 0.5) / SS;
                    let inBg;
                    if (rounded) inBg = insideRounded(fx, fy, S, radius);
                    else inBg = true;
                    if (!inBg) continue;
                    bgCount++;
                    // map into scaled art space around center
                    const px = (fx - S / 2) / scale + S / 2;
                    const py = (fy - S / 2) / scale + S / 2;
                    if (insideBag(px, py, S)) fgCount++;
                }
            }
            const i = (y * S + x) * 4;
            if (bgCount === 0) { buf[i + 3] = 0; continue; } // transparent corner
            const t = fgCount / bgCount;
            buf[i]     = Math.round(BG[0] + (FG[0] - BG[0]) * t);
            buf[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * t);
            buf[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * t);
            buf[i + 3] = 255;
        }
    }
    return encodePng(S, S, buf);
}

// ---- Write files --------------------------------------------------------
const outDir = path.join(__dirname, 'frontend', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
    { file: 'icon-192.png', size: 192, opts: {} },
    { file: 'icon-512.png', size: 512, opts: {} },
    { file: 'icon-512-maskable.png', size: 512, opts: { rounded: false, scale: 0.82 } }
];

targets.forEach(t => {
    const png = makeIcon(t.size, t.opts);
    fs.writeFileSync(path.join(outDir, t.file), png);
    console.log('wrote frontend/icons/' + t.file + ' (' + png.length + ' bytes)');
});
console.log('DONE');