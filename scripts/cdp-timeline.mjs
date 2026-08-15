// 时间线实机探针：重载（新折叠器回放历史）→ 新会话真实任务 → 断言消息顺序与节点。
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost')) ?? ctx.pages()[0];
await page.reload();
await page.waitForTimeout(4500);

// 用量行与单键断言（上一轮改动一并验证）
console.log('USAGE_ROWS', await page.locator('.msg__usage').count());
console.log('SEND_BTNS', await page.locator('.composer__send').count());
console.log('OLD_STOP', await page.locator('.composer__icon-btn--stop').count());

// 新会话 + 真实任务（触发 glob/read 工具链）
await page.locator('.sb-nav__item', { hasText: '新对话' }).first().click();
await page.waitForTimeout(800);
const ta = page.locator('.composer__textarea');
await ta.click();
await ta.pressSequentially('列出项目根目录的 .md 文件名，然后只回复文件数量', { delay: 12 });
await page.keyboard.press('Enter');

// 等回合结束（单键回到发送态）
const deadline = Date.now() + 150_000;
let done = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(4000);
  const stop = await page.locator('.composer__send--stop').count();
  if (stop === 0) {
    const texts = await page.locator('.round__body .msg__text').allInnerTexts();
    if (texts.some((t) => t.trim().length > 0)) {
      done = true;
      break;
    }
  }
}
console.log('TURN_DONE', done);

// 结构断言：轮 → 消息顺序（思考消息在前、工具消息、最终文本消息最后）与节点数
const structure = await page.evaluate(() => {
  const round = document.querySelector('.round');
  const msgs = [...(round?.querySelectorAll('.round__body > .msg') ?? [])];
  return {
    rounds: document.querySelectorAll('.round').length,
    msgCount: msgs.length,
    order: msgs.map((m) => ({
      hasReasoning: m.querySelector('.msg__reasoning') !== null,
      hasText: (m.querySelector('.msg__text')?.textContent ?? '').trim().length > 0,
      tools: [...m.querySelectorAll('.toollow__text')].map((t) => t.textContent?.slice(0, 24)),
    })),
    dots: getComputedStyle,
    dotCount: round ? round.querySelectorAll('.round__body > .msg').length : 0,
    usageRows: document.querySelectorAll('.msg__usage').length,
  };
});
console.log('STRUCTURE', JSON.stringify(structure, null, 1));

// 上下文详情分类型
const wrap = page.locator('.composer__ctxwrap');
if ((await wrap.count()) > 0) {
  await wrap.hover();
  await page.waitForTimeout(400);
  console.log('CTX_STATS', JSON.stringify(await page.locator('.composer__ctxpop-stat').allInnerTexts()));
  await page.mouse.move(0, 0);
}
await page.screenshot({ path: 'out/timeline.png' });
await browser.close();
