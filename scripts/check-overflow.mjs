import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distIndex = path.resolve(__dirname, '../dist/index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
await page.goto(`file://${distIndex}`);
await page.waitForTimeout(2000);
const result = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  bodyScrollWidth: document.body.scrollWidth,
  bodyClientWidth: document.body.clientWidth,
  overflowElements: Array.from(document.querySelectorAll('*')).map(el => {
    const rect = el.getBoundingClientRect();
    const docWidth = document.documentElement.clientWidth;
    const overflowX = rect.right > docWidth + 1;
    return overflowX ? {
      tag: el.tagName.toLowerCase(),
      classes: el.className,
      rectRight: rect.right,
      rectLeft: rect.left,
      width: rect.width,
      text: el.textContent?.trim().slice(0, 120)
    } : null;
  }).filter(Boolean)
}));
console.log(JSON.stringify(result, null, 2));
await browser.close();
