const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const root = path.resolve(__dirname, "..");
const pngOutput = path.join(root, "img", "sales-tracker-icon.png");
const icoOutput = path.join(root, "img", "sales-tracker.ico");

const size = 256;
const data = Buffer.alloc(size * size * 4);

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function roundedRectContains(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;

  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function drawRoundedRect(left, top, width, height, radius, colorFn) {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      if (roundedRectContains(x, y, left, top, width, height, radius)) {
        const color = colorFn(x, y);
        setPixel(x, y, color[0], color[1], color[2], color[3] ?? 255);
      }
    }
  }
}

function drawBar(left, top, width, height, radius, alpha = 255) {
  drawRoundedRect(left, top, width, height, radius, () => [255, 255, 255, alpha]);
}

function makePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const chunks = [];
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, payload) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
    chunks.push(Buffer.concat([length, typeBuffer, payload, crc]));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  chunk("IHDR", ihdr);
  chunk("IDAT", zlib.deflateSync(raw));
  chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ...chunks]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    setPixel(x, y, 0, 0, 0, 0);
  }
}

drawRoundedRect(24, 24, 208, 208, 54, (x, y) => {
  const t = (x + y) / (size * 2);
  return [
    lerp(37, 20, t),
    lerp(99, 184, t),
    lerp(235, 166, t)
  ];
});

drawBar(70, 130, 28, 56, 14, 255);
drawBar(114, 96, 28, 90, 14, 236);
drawBar(158, 62, 28, 124, 14, 215);

for (let x = 62; x < 194; x++) {
  for (let y = 189; y < 203; y++) {
    if ((x - 62) ** 2 + (y - 196) ** 2 < 49 || (x - 193) ** 2 + (y - 196) ** 2 < 49 || (x >= 62 && x <= 193)) {
      setPixel(x, y, 255, 255, 255, 225);
    }
  }
}

fs.writeFileSync(pngOutput, makePng(size, size, data));

pngToIco(pngOutput)
  .then(buffer => {
    fs.writeFileSync(icoOutput, buffer);
    console.log(`Desktop icon created: ${icoOutput}`);
  })
  .catch(error => {
    console.error("Could not create desktop icon:", error.message);
    process.exit(1);
  });
