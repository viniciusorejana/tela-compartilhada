// Rasterize the repository SVG at native Windows icon sizes; no external artwork.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const svg = fs.readFileSync(path.join(__dirname, '../public/mark.svg'), 'utf8');
    const entries = [];
    for (const size of [16, 32, 48, 256]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>' + svg);
      entries.push({ size, png: await page.screenshot({ omitBackground: true }) });
    }
    const header = Buffer.alloc(6 + 16 * entries.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    let offset = header.length;
    entries.forEach(({ size, png }, i) => {
      const index = 6 + i * 16;
      header[index] = header[index + 1] = size % 256;
      header.writeUInt16LE(1, index + 4);
      header.writeUInt16LE(32, index + 6);
      header.writeUInt32LE(png.length, index + 8);
      header.writeUInt32LE(offset, index + 12);
      offset += png.length;
    });
    fs.writeFileSync(path.join(__dirname, '../app/icon.ico'), Buffer.concat([header, ...entries.map(e => e.png)]));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
