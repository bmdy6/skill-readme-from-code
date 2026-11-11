// Render a showcase HTML card to a transparent WebP-ready PNG at 2x.
// Usage: node scripts/showcase-shot.mjs FILE.html OUT.png [WIDTH=838]
import path from "node:path";
import { chromium } from "playwright";
const [, , html, out, width = "838"] = process.argv;
if (!html || !out) {
  console.error("Usage: showcase-shot.mjs FILE.html OUT.png [WIDTH]");
  process.exit(2);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: +width, height: 600 },
    deviceScaleFactor: 2,
  });
  await page.goto("file://" + path.resolve(html), { waitUntil: "networkidle" });
  const body = await page.$("body > *");
  await body.screenshot({ path: out, omitBackground: true });
} finally {
  await browser.close();
}
