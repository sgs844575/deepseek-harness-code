/**
 * Headless 冒烟测试：以与 Electron 主进程完全相同的方式 boot 我们的
 * cordis.yml 组合，走一轮 用户输入 → 流式回复 → 回合结束 闭环。
 *
 * 前置：先启动 harness 自带的 mock LLM（OpenAI 兼容）：
 *   cd deepseek-harness && node --import tsx packages/test-support/llm-mock-server/src/bin.ts \
 *     --sequence success --success-text "冒烟回复 OK" --reasoning-text "模拟思考" --repeat-last
 * 然后：node scripts/smoke-harness.mjs
 *
 * 工具+审批模式（SMOKE_TOOL=1，另需 mock --sequence tool_call_success,success
 * --tool-name pwsh --tool-arguments '{"command":"Write-Output smoke-ok"}'）：
 * 验证 审批瀑布 → pwsh 工具 → subprocess-child 子进程执行 全链路。
 * 退出码 0 = 通过。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const harnessRoot = path.join(projectRoot, 'deepseek-harness');

process.env.DSH_HOME = mkdtempSync(path.join(tmpdir(), 'dshc-smoke-home-'));
process.env.DSH_CWD = projectRoot; // 工作区：本项目
process.env.DSH_HARNESS_ROOT = harnessRoot;
process.env.DSH_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'http://127.0.0.1:8000/v1';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'mock-key';

const bootUrl = pathToFileURL(
  path.join(harnessRoot, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
).href;
const llmUrl = pathToFileURL(path.join(harnessRoot, 'packages', 'llm', 'llm', 'lib', 'index.js')).href;

const { boot } = await import(bootUrl);
const { createUserMessage } = await import(llmUrl);

const events = [];
const ctx = await boot('dsh-code-smoke', path.join(projectRoot, 'config', 'harness', 'cordis.yml'));
ctx.on('session/event', (session, event) => {
  if (session.id === 'smoke-session') events.push(event);
});
ctx.on('agent/error', (payload) => {
  console.error('[agent/error]', JSON.stringify(payload).slice(0, 2000));
});

// 工具+审批模式：注册与客户端 InteractionBridge 相同语义的门与应答器。
const approvalLog = [];
if (process.env.SMOKE_TOOL === '1') {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (['pwsh', 'write', 'edit', 'str_replace_editor'].includes(exec.name)) {
      return Promise.resolve({ kind: 'ask', reason: `工具 ${exec.name} 需要用户审批` });
    }
    return next();
  });
  ctx.on('approval/request', (req) => {
    approvalLog.push(req.toolName);
    return Promise.resolve('allowed-once');
  });
}

const firstHandle = await ctx.agents.create({
  sessionId: 'smoke-session',
  meta: { cwd: projectRoot },
  agentOptions: ctx.agentDefaultModel.currentSelection(),
});
const agent = firstHandle.agent;
agent.followup(
  createUserMessage({ content: [{ type: 'text', text: '你好，请回复冒烟确认。' }], source: { kind: 'user' } }),
);
await agent.whenIdle();

const textDeltas = events.filter((e) => e.type === 'assistant/chunk' && e.data?.chunk?.type === 'text-delta');
const reasoningDeltas = events.filter((e) => e.type === 'assistant/chunk' && e.data?.chunk?.type === 'reasoning-delta');
const finalMessages = events.filter((e) => e.type === 'assistant/message');
const turnEnds = events.filter((e) => e.type === 'turn/end');
const toolCalls = events.filter((e) => e.type === 'tool/call');
const toolResults = events.filter((e) => e.type === 'tool/result');
const finalText = finalMessages
  .flatMap((e) => e.data.message.content.filter((b) => b.type === 'text').map((b) => b.text))
  .join('');

let failure;
if (process.env.SMOKE_TOOL === '1') {
  if (approvalLog.length === 0) failure = '没有触发审批请求（tools/pre-execute 门未生效？）';
  else if (!toolCalls.some((e) => e.data.name === 'pwsh')) failure = '没有 pwsh 工具调用';
  else if (toolResults.length === 0) failure = '没有工具结果';
  else if (toolResults.some((e) => e.data.error !== undefined)) failure = '工具结果带错误';
  else if (!JSON.stringify(toolResults).includes('smoke-ok')) failure = 'pwsh 输出中找不到 smoke-ok';
} else if (textDeltas.length === 0) failure = '没有收到 assistant/chunk text-delta 流';
else if (finalMessages.length === 0) failure = '没有收到 assistant/message 最终消息';
else if (finalText.length === 0) failure = '最终消息没有文本内容';
else if (turnEnds.length === 0) failure = '没有收到 turn/end';

if (failure) {
  console.error('SMOKE FAIL:', failure);
  console.error('事件类型分布:', events.map((e) => e.type).join(', ') || '(无)');
  const toolResultsDebug = events.filter((e) => e.type === 'tool/result');
  for (const event of toolResultsDebug) {
    console.error('tool/result 详情:', JSON.stringify(event).slice(0, 3000));
  }
  await ctx.fiber.dispose().catch(() => {});
  rmSync(process.env.DSH_HOME, { recursive: true, force: true });
  process.exit(1);
}

console.log('SMOKE PASS');
console.log(`  text-delta: ${textDeltas.length} 条, reasoning-delta: ${reasoningDeltas.length} 条`);
console.log(`  最终回复: ${finalText.slice(0, 80)}`);
console.log(`  turn/end: ${turnEnds.length} 次, tool/call: ${toolCalls.length} 次, 审批: ${approvalLog.join(',') || '(无)'}`);

// ---- 持久化与恢复（M4）：list → inspect → resume → 第二轮对话 ----
events.length = 0;
await firstHandle.dispose().catch(() => {});

const listed = await ctx.sessionPersistence.list();
if (!listed.some((header) => header.id === 'smoke-session')) {
  console.error('SMOKE FAIL(恢复): 持久化列表中找不到 smoke-session');
  await ctx.fiber.dispose().catch(() => {});
  rmSync(process.env.DSH_HOME, { recursive: true, force: true });
  process.exit(1);
}

const inspection = await ctx.sessionPersistence.inspect('smoke-session');
const replayedText = inspection.events
  .filter((e) => e.type === 'assistant/message')
  .flatMap((e) => e.data.message.content.filter((b) => b.type === 'text').map((b) => b.text))
  .join('');
if (replayedText.length === 0) {
  console.error('SMOKE FAIL(恢复): inspect 回放没有 assistant 文本');
  await ctx.fiber.dispose().catch(() => {});
  rmSync(process.env.DSH_HOME, { recursive: true, force: true });
  process.exit(1);
}

const resumed = await ctx.agents.resume({
  resumeSessionId: 'smoke-session',
  agentOptions: ctx.agentDefaultModel.currentSelection(),
});
resumed.agent.followup(
  createUserMessage({ content: [{ type: 'text', text: '第二轮：请再次回复。' }], source: { kind: 'user' } }),
);
await resumed.agent.whenIdle();
const secondTurns = events.filter((e) => e.type === 'turn/end');
if (secondTurns.length === 0) {
  console.error('SMOKE FAIL(恢复): 恢复后第二轮没有 turn/end');
  await resumed.dispose().catch(() => {});
  await ctx.fiber.dispose().catch(() => {});
  rmSync(process.env.DSH_HOME, { recursive: true, force: true });
  process.exit(1);
}
console.log(`  恢复回放文本: ${replayedText.slice(0, 40)}`);
console.log('SMOKE PASS(恢复)');
await resumed.dispose().catch(() => {});

await ctx.fiber.dispose().catch(() => {});
rmSync(process.env.DSH_HOME, { recursive: true, force: true });
