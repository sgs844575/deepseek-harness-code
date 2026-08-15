// 斜杠命令实机探针：连接 9222，验证 / 菜单弹出、过滤、键盘执行、Esc 收起。
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost')) ?? ctx.pages()[0];
await page.waitForTimeout(1500);

const ta = page.locator('.composer__textarea');
await ta.click();
await ta.fill('/');
await page.waitForTimeout(300);
const allItems = await page.locator('.composer__slash .composer__pop-item').allInnerTexts();
console.log('OPEN_ALL', JSON.stringify(allItems));
await page.screenshot({ path: 'out/slash-open.png' });

// 过滤：/mo → 模型
await ta.fill('/mo');
await page.waitForTimeout(250);
const filtered = await page.locator('.composer__slash .composer__pop-item').allInnerTexts();
console.log('FILTER_mo', JSON.stringify(filtered));

// 键盘：↓ 选中 + Enter 执行（模型菜单应打开）
await ta.press('Enter');
await page.waitForTimeout(300);
const modelMenuOpen = await page.locator('.composer__pop--model').count();
console.log('MODEL_MENU_OPEN', modelMenuOpen);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Esc 收起斜杠菜单但保留文本
await ta.fill('/');
await ta.press('Escape');
await page.waitForTimeout(200);
const closedCount = await page.locator('.composer__slash').count();
const textAfter = await ta.inputValue();
console.log('ESC_CLOSE', closedCount, 'TEXT_KEPT', JSON.stringify(textAfter));

// 中文前缀匹配：/设
await ta.fill('/设');
await page.waitForTimeout(250);
const zh = await page.locator('.composer__slash .composer__pop-item').allInnerTexts();
console.log('FILTER_zh', JSON.stringify(zh));
await ta.fill('');
await browser.close();
