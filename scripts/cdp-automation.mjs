// 自动化实机探针：侧栏入口 → 新建 1 分钟间隔任务 → 等待后台触发 → 侧栏出现新会话 + lastRun ok。
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost')) ?? ctx.pages()[0];
await page.waitForTimeout(4000);

// 1) 侧栏「自动化」入口
const nav = page.locator('.sb-nav__item', { hasText: '自动化' });
console.log('NAV_COUNT', await nav.count());
await nav.first().click();
await page.waitForTimeout(500);
console.log('ACTIVE_SECTION', await page.locator('.settingspage__nav-item--active').innerText());

// 2) 新建：间隔 1 分钟
await page.locator('button', { hasText: '新建任务' }).click();
await page.waitForTimeout(300);
await page.locator('.automation-form input[type="text"]').first().fill('探针简报');
await page.locator('.automation-form select').first().selectOption('interval');
await page.locator('.automation-form input[type="number"]').fill('1');
await page.locator('.automation-form textarea').fill('请只回复四个字：自动化探针');
await page.locator('button', { hasText: '保存任务' }).click();
await page.waitForTimeout(500);
const rows = await page.locator('.automation-row, .settings-row--stack').allInnerTexts();
console.log('TASK_ROWS', JSON.stringify(rows.filter((t) => t.includes('探针简报'))));
await page.screenshot({ path: 'out/automation-form.png' });

// 3) 返回工作区，轮询侧栏新会话（后台建会话 + 未知会话刷新链路）
await page.locator('.settingspage__back').click();
const before = await page.locator('.sb-item').count();
console.log('SB_ITEMS_BEFORE', before);

let fired = false;
const deadline = Date.now() + 170_000;
while (Date.now() < deadline) {
  await page.waitForTimeout(5000);
  const count = await page.locator('.sb-item').count();
  if (count > before) {
    fired = true;
    break;
  }
}
console.log('FIRED_SIDEBAR', fired, 'AFTER', await page.locator('.sb-item').count());
await page.screenshot({ path: 'out/automation-fired.png' });

// 4) 设置持久化里的 lastRun 状态
const { readFileSync } = await import('node:fs');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const settingsPath = join(homedir(), '.deep-seek-harness-code', 'app-settings.json');
const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
const task = saved.automations?.find?.((a) => a.name === '探针简报');
console.log('STORED_TASK', JSON.stringify(task));
await browser.close();
