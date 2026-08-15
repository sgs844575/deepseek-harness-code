// CDP 截图探针：连接 9222，对第一个页面截图并输出关键元素几何信息。
import { chromium } from 'playwright';

const query = process.argv[2] ?? '';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().startsWith('app://') || p.url().includes('index')) ?? ctx.pages()[0];
if (page === undefined) {
  console.log('NO_PAGE', ctx.pages().map((p) => p.url()));
  process.exit(1);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: 'out/shot.png' });
console.log('URL', page.url());
if (query.length > 0) {
  const info = await page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, text: el.textContent?.slice(0, 24), h: Math.round(r.height), w: Math.round(r.width), y: Math.round(r.y) };
    }),
  query);
  console.log(JSON.stringify(info, null, 1));
}
await browser.close();
