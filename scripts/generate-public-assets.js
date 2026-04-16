// scripts/generate-public-assets.js (run at build time)
// Syncs favicon.ico, logo.png, and og-image.jpg for the site.
//
// Reads from CMS_SITE_DIR env var (e.g. /path/to/my-site/site/).
// Assets are read from {CMS_SITE_DIR}/assets/, config from
// {CMS_SITE_DIR}/content/{baseLocale}/site.json, output is written to
// {dirname(CMS_SITE_DIR)}/public/.

import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, registerFont } from 'canvas';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Layout resolution ----

const CMS_SITE_DIR = process.env.CMS_SITE_DIR
  ? path.resolve(process.env.CMS_SITE_DIR)
  : null;

if (!CMS_SITE_DIR || !fs.existsSync(CMS_SITE_DIR)) {
  console.error('❌ CMS_SITE_DIR environment variable is required and must point to an existing directory.');
  console.error('   Example: CMS_SITE_DIR=./site npx cms-generate-public-assets');
  process.exit(1);
}

const PUBLIC_DIR = path.join(path.dirname(CMS_SITE_DIR), 'public');

function resolveSiteAssetFile(relativePaths = []) {
  for (const rel of relativePaths) {
    if (!rel) continue;
    const candidate = path.join(CMS_SITE_DIR, rel);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveSiteAssetsDir() {
  const assetsDir = path.join(CMS_SITE_DIR, 'assets');
  return fs.existsSync(assetsDir) ? assetsDir : null;
}

function resolveSiteImageDir() {
  const assetsDir = resolveSiteAssetsDir();
  if (!assetsDir) return null;
  const imgDir = path.join(assetsDir, 'img');
  return fs.existsSync(imgDir) ? imgDir : null;
}

function resolveFirstExistingFile(paths = []) {
  for (const candidate of paths) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(Math.max(0, Math.min(255, r)))}${toHex(Math.max(0, Math.min(255, g)))}${toHex(Math.max(0, Math.min(255, b)))}`;
}

function adjustLum(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r + amt, g: g + amt, b: b + amt });
}

function luminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Try to register a professional-looking font if available
function tryRegisterFonts() {
  const candidates = [
    path.join(process.cwd(), 'public', 'fonts', 'Inter-Bold.ttf'),
    path.join(process.cwd(), 'public', 'fonts', 'Nunito-Black.ttf'),
    path.join(process.cwd(), 'assets', 'fonts', 'Inter-Bold.ttf'),
    path.join(__dirname, 'fonts', 'Inter-Bold.ttf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        registerFont(p, { family: 'BrandBold' });
        console.log(`ℹ️  Using custom font: ${p}`);
        return 'BrandBold';
      } catch (e) {
        // continue trying others
      }
    }
  }
  return 'Sans';
}
const FONT_FAMILY = tryRegisterFonts();

function renderLetterPng(letter, size, { bg = '#ffffff', fg = '#000000' } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 3D coin background (radial gradient + rim + inner shadow + highlight)
  const cx = size / 2;
  const cy = size / 2;
  const rimOuter = Math.max(1, Math.floor(size * 0.06));
  const rimInner = Math.max(1, Math.floor(size * 0.02));
  const margin   = Math.ceil(size * 0.01);
  const r  = size / 2 - rimOuter / 2 - margin;

  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  grad.addColorStop(0, adjustLum(bg, +40));
  grad.addColorStop(0.55, bg);
  grad.addColorStop(1, adjustLum(bg, -40));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = rimOuter;
  ctx.strokeStyle = adjustLum(bg, -60);
  ctx.stroke();
  ctx.lineWidth = rimInner;
  ctx.strokeStyle = adjustLum(bg, +60);
  ctx.stroke();

  const inner = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  const hlr = r * 0.75;
  const hlGrad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.40, r * 0.05, cx - r * 0.35, cy - r * 0.40, hlr);
  hlGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
  hlGrad.addColorStop(0.35, 'rgba(255,255,255,0.20)');
  hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hlGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const pad = Math.max(2, Math.floor(size * 0.14));
  const target = 2 * (r - pad);

  let fontSize = Math.floor(size * 0.9);
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  let m = ctx.measureText(letter);
  let height = (m.actualBoundingBoxAscent || fontSize * 0.8) + (m.actualBoundingBoxDescent || fontSize * 0.2);
  let width  = Math.max(1, m.width);
  let scale  = Math.min(target / height, target / width);
  fontSize = Math.floor(fontSize * scale * 0.96);
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;

  m = ctx.measureText(letter);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.2;
  let y = cy + (ascent - (ascent + descent) / 2);
  y += size * 0.06;

  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = Math.max(1, Math.floor(size * 0.05));
  ctx.shadowOffsetY = Math.floor(size * 0.015);

  const fgRgb = hexToRgb(fg);
  const strokeIsDark = luminance(fgRgb) > 128;
  ctx.lineWidth = Math.max(1, Math.floor(size * 0.045));
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeIsDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.65)';

  ctx.strokeText(letter, cx, y);
  ctx.fillStyle = fg;
  ctx.fillText(letter, cx, y);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  return canvas.toBuffer('image/png');
}

function renderOgImageBuffer(text, { width = 1200, height = 630, bg = '#000000', fg = '#ffffff' } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, adjustLum(bg, +20));
  background.addColorStop(0.5, bg);
  background.addColorStop(1, adjustLum(bg, -40));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const highlight = ctx.createLinearGradient(0, 0, 0, height);
  highlight.addColorStop(0, 'rgba(255,255,255,0.12)');
  highlight.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = width * 0.8;
  let fontSize = Math.floor(height * 0.22);

  const safeText = (text && text.toString().trim()) || '';
  const displayText = safeText || 'Coming Soon';

  const setFont = (size) => {
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
  };

  setFont(fontSize);
  let metrics = ctx.measureText(displayText);
  while (metrics.width > maxWidth && fontSize > 32) {
    fontSize -= 2;
    setFont(fontSize);
    metrics = ctx.measureText(displayText);
  }

  const textX = width / 2;
  const textY = height / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.max(4, Math.floor(height * 0.04));
  ctx.shadowOffsetY = Math.floor(height * 0.015);

  const fgRgb = hexToRgb(fg);
  const strokeIsDark = luminance(fgRgb) > 150;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, Math.floor(height * 0.02));
  ctx.strokeStyle = strokeIsDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';
  ctx.strokeText(displayText, textX, textY);
  ctx.fillStyle = fg;
  ctx.fillText(displayText, textX, textY);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

function loadSiteTitle() {
  const contentDir = path.join(CMS_SITE_DIR, 'content');
  const contentConfigPath = path.join(contentDir, 'content.config.json');
  let baseLocale = 'en';
  try {
    if (fs.existsSync(contentConfigPath)) {
      const cc = JSON.parse(fs.readFileSync(contentConfigPath, 'utf-8'));
      baseLocale = cc.baseLocale || 'en';
    }
  } catch { /* use default */ }

  const configPath = path.join(contentDir, baseLocale, 'site.json');
  if (!fs.existsSync(configPath)) return '';
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Flat format: key is "title"; nested format: key is "site.title" or nested
    const title = parsed?.title || parsed?.['site.title'] || parsed?.site?.title;
    if (typeof title === 'string' && title.trim()) {
      return title.trim();
    }
  } catch (err) {
    console.warn(`⚠️  Could not read site config: ${configPath}`, err);
  }
  return '';
}

async function generateFavicon() {
  const siteTitle = loadSiteTitle() || 'X';
  const letter = siteTitle.charAt(0).toUpperCase();

  const publicDir = PUBLIC_DIR;
  fs.mkdirSync(publicDir, { recursive: true });
  const icoPath = path.join(publicDir, 'favicon.ico');

  console.log(`📁 Reading site from ${CMS_SITE_DIR}`);
  console.log(`   Writing to ${publicDir}`);

  const assetSearchDir = resolveSiteImageDir();
  if (!assetSearchDir) {
    const assetsDir = resolveSiteAssetsDir();
    const expectedImageDir = assetsDir ? path.join(assetsDir, 'img') : path.join(CMS_SITE_DIR, 'assets', 'img');
    console.warn(`⚠️  Expected asset folder not found at ${expectedImageDir}; will fall back to generated assets.`);
  }

  const logoSource = assetSearchDir
    ? resolveFirstExistingFile([
        path.join(assetSearchDir, 'logo.png'),
        path.join(assetSearchDir, 'logo.jpg'),
        path.join(assetSearchDir, 'logo.jpeg'),
      ])
    : null;
  const logoDest = path.join(publicDir, 'logo.png');
  if (logoSource) {
    try {
      fs.copyFileSync(logoSource, logoDest);
      console.log(`🔁 Copied brand logo from ${logoSource} to ${logoDest}`);
    } catch (err) {
      console.warn(`⚠️  Failed to copy brand logo from ${logoSource}`, err);
    }
  }

  const ogSource = resolveSiteAssetFile(['og-image.jpg', 'og-image.jpeg']);
  const ogDest = path.join(publicDir, 'og-image.jpg');
  let shouldGenerateOg = false;
  if (ogSource) {
    try {
      fs.copyFileSync(ogSource, ogDest);
      console.log(`📸 Copied OpenGraph image from ${ogSource} to ${ogDest}`);
    } catch (err) {
      console.warn(`⚠️  Failed to copy OpenGraph image from ${ogSource}`, err);
      shouldGenerateOg = true;
    }
  } else {
    shouldGenerateOg = true;
  }

  const providedFavicon = resolveSiteAssetFile(['favicon.ico']);
  if (providedFavicon) {
    fs.copyFileSync(providedFavicon, icoPath);
    console.log(`✅ Found existing favicon; copied from ${providedFavicon}`);
    return;
  }

  console.log(`Generating favicon.ico using letter "${letter}" from site "${siteTitle}"`);

  function getRandomColorPair() {
    const colors = [
      ['#ffffff', '#000000'],
      ['#000000', '#ffffff'],
      ['#ff0000', '#ffffff'],
      ['#0000ff', '#ffffff'],
      ['#008000', '#ffffff'],
      ['#ffff00', '#000000'],
      ['#ff00ff', '#000000'],
      ['#00ffff', '#000000'],
      ['#1e90ff', '#ffffff'],
      ['#ff8c00', '#000000'],
      ['#4b0082', '#ffffff'],
      ['#32cd32', '#000000'],
      ['#8b0000', '#ffffff'],
      ['#ffd700', '#000000'],
      ['#ff69b4', '#000000'],
      ['#2f4f4f', '#ffffff']
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  let bg = process.env.FAVICON_BG;
  let fg = process.env.FAVICON_FG;

  if (!bg || !fg) {
    [bg, fg] = getRandomColorPair();
  }

  if (shouldGenerateOg) {
    try {
      const ogBuffer = renderOgImageBuffer(siteTitle, { width: 1200, height: 630, bg, fg });
      fs.writeFileSync(ogDest, ogBuffer);
      console.log(`🖼️  Generated fallback OpenGraph image at ${ogDest}`);
    } catch (err) {
      console.error(`❌ Failed to generate fallback OpenGraph image`, err);
    }
  }

  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = sizes.map((s) => renderLetterPng(letter, s, { bg, fg }));

  const pngPath = path.join(publicDir, 'favicon-256.png');
  fs.writeFileSync(pngPath, pngBuffers[0]);

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(icoPath, ico);

  try {
    fs.unlinkSync(pngPath);
    console.log(`🗑️  Removed temporary file ${pngPath}`);
  } catch (err) {
    console.warn(`⚠️  Could not remove temporary PNG: ${pngPath}`, err);
  }

  console.log(`✅ Created favicon.ico using letter "${letter}" from site "${siteTitle}"`);
  console.log(`   Colors bg=${bg} fg=${fg}`);
  console.log(`   Wrote: ${icoPath}`);
}

generateFavicon().catch((err) => {
  console.error('❌ Failed to generate favicon.ico');
  console.error(err);
  process.exit(1);
});
