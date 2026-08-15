// 项目规则（AGENTS.md）实机探针：/规则 直达设置分区，项目层写入→保存→磁盘回读。
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost')) ?? ctx.pages()[0];
await page.waitForTimeout(1500);

const ta = page.locator('.composer__textarea');
await ta.click();
await ta.pressSequentially('/规则', { delay: 40 });
await page.waitForTimeout(400);
const items = await page.locator('.composer__slash .composer__pop-item').allInnerTexts();
console.log('SLASH_RULES', JSON.stringify(items));
await ta.press('Enter');
await page.waitForTimeout(800);

const activeNav = await page.locator('.settingspage__nav-item--active').innerText().catch(() => 'NONE');
console.log('ACTIVE_SECTION', activeNav);
const editors = page.locator('.settingspage__rules-editor');
console.log('EDITOR_COUNT', await editors.count());
const paths = await page.locator('.settingspage__path').allInnerTexts();
console.log('PATHS', JSON.stringify(paths));

// 项目层写入 → 保存 → 磁盘回读
const project = editors.nth(1);
await project.click();
await project.fill('# DSHC 规则探针\n- 运行 npm test');
await page.waitForTimeout(200);
await page.locator('.settingspage__save--primary:not(:disabled)').last().click();
await page.waitForTimeout(600);
const badges = await page.locator('.settingspage__rules-badge').allInnerTexts();
console.log('BADGES_AFTER_SAVE', JSON.stringify(badges));

const { readFileSync, existsSync } = await import('node:fs');
const { join } = await import('node:path');
const projPath = join(process.cwd(), 'AGENTS.md');
console.log('DISK_PROJECT', existsSync(projPath) ? JSON.stringify(readFileSync(projPath, 'utf-8')) : 'MISSING');

await page.screenshot({ path: 'out/rules.png' });
await browser.close();
