// Builds the PWA icon set from the IntelQA mark (same geometry as IntelQAIcon.dc.html).
// Usage: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const MARK = (ring, dot) => `
  <path d="M47 9a38 38 0 1 0 0.01 0zM47 26a21 21 0 1 1 -0.01 0z" fill="${ring}" fill-rule="evenodd"/>
  <rect x="61.3" y="66.3" width="28" height="18" rx="3" transform="rotate(45 75.3 75.3)" fill="${ring}"/>
  <circle cx="47" cy="47" r="10" fill="${dot}"/>`;

/** A square tile with the mark centred at `scale` of the tile, nudged 2% like the source. */
function tile({ size, bg, ring, dot, scale, radius = 0 }) {
  const inner = size * scale;
  const offset = (size - inner) / 2 + size * scale * 0.02;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ""}
    <g transform="translate(${offset} ${offset}) scale(${inner / 100})">${MARK(ring, dot)}</g>
  </svg>`;
}

const out = "public/icons";
mkdirSync(out, { recursive: true });
const brand = { bg: "#5B3DF5", ring: "#FFFFFF", dot: "#FFD43B" };
const jobs = [
  ["icon-192.png", tile({ size: 192, ...brand, scale: 0.6 })],
  ["icon-512.png", tile({ size: 512, ...brand, scale: 0.6 })],
  // Maskable: keep the mark inside the 80% safe zone.
  ["maskable-512.png", tile({ size: 512, ...brand, scale: 0.5 })],
  ["apple-touch-icon.png", tile({ size: 180, ...brand, scale: 0.6 })],
  // Android themed icon: single colour on transparent.
  ["monochrome-512.png", tile({ size: 512, bg: null, ring: "#FFFFFF", dot: "#FFFFFF", scale: 0.5 })],
];
for (const [name, svg] of jobs) await sharp(Buffer.from(svg)).png().toFile(`${out}/${name}`);

// Favicon as SVG: rounded tile, slightly larger mark so it holds up at 16px.
writeFileSync("src/app/icon.svg", tile({ size: 64, ...brand, scale: 0.7, radius: 14 }));
// favicon.ico for browsers that ask for it directly: an ICO wrapping one 32px PNG.
const png32 = await sharp(Buffer.from(tile({ size: 32, ...brand, scale: 0.7, radius: 7 }))).png().toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type icon, 1 image
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png32.length, 14); head.writeUInt32LE(22, 18);
writeFileSync("public/favicon.ico", Buffer.concat([head, png32]));
console.log("Icons written to", out, ", src/app/icon.svg and public/favicon.ico");
