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
 *
 * 子代理模式（SMOKE_SUBAGENT=1，另需 mock --sequence tool_call_success,success
 * --tool-name subagent --tool-arguments '{"description":"冒烟子代理","prompt":"请回复子代理确认"}'）：
 * 验证 subagent 工具 → 进程内子会话 → subagent/start|end 事件 → 子会话持久化
 * （origin=subagent + parentSession）→ 结果回传父回合。
 *
 * 派生模式（SMOKE_FORK=1，配基础 mock 即可）：以 completed-turn 种子创建新会话，
 * 验证历史继承与新回合可继续。
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
process.env.DSH_CONFIG_DIR = path.join(projectRoot, 'config', 'harness'); // 随附预设根
// DSH_BASE_URL 显式优先（DEEPSEEK_BASE_URL 可能来自机器全局环境）。
process.env.DSH_BASE_URL =
  process.env.DSH_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'http://127.0.0.1:8000/v1';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'mock-key';

const bootUrl = pathToFileURL(
  path.join(harnessRoot, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
).href;
const llmUrl = pathToFileURL(
  path.join(harnessRoot, 'packages', 'llm', 'llm', 'lib', 'index.js'),
).href;

const { boot } = await import(bootUrl);
const { createUserMessage } = await import(llmUrl);

/**
 * Agent 预设组装（与主进程 HarnessService.composeAgent 同模式）：
 * 预设 id（缺省 = roster 默认 plugin）→ 头记录 + 工厂 setup 挂载。
 * 模型面已全部迁入预设，不挂载的 agent 只有空全局层（无工具）。
 */
async function composeAgent(presetId) {
  const presets = ctx.agentPresets;
  if (presets === undefined) return {};
  const resolved = await presets.resolve(presetId);
  return {
    agentPreset: resolved.id,
    // setup 必须归一到 void（工厂会把非空返回值当 AgentSetupCommit.commit 调用）。
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolved.id);
    },
  };
}

/** 会话实际运行的预设（resolveSessionPreset 语义）：selected 事件 last-wins > 头。 */
function resolveSessionPreset(inspection) {
  for (let i = inspection.events.length - 1; i >= 0; i -= 1) {
    if (inspection.events[i]?.type === 'agent-preset/selected') {
      return inspection.events[i].data.agentPreset;
    }
  }
  return inspection.meta.agentPreset;
}

const events = [];
const ctx = await boot('dsh-code-smoke', path.join(projectRoot, 'config', 'harness', 'cordis.yml'));
// llm-deepseek 的 baseURL 在设置文档里（多供应商改造后不再读环境变量），
// 冒烟直接整段写入 mock 地址（与主进程 updateLlmSection 同一通道）。
await ctx.settings.replace('llm-deepseek', {
  baseURL: process.env.DSH_BASE_URL,
  models: [{ id: 'deepseek-v4-flash' }],
  thinking: 'enabled',
  reasoningEffort: 'high',
});
ctx.on('session/event', (session, event) => {
  if (session.id === 'smoke-session') events.push(event);
});
ctx.on('agent/error', (payload) => {
  console.error('[agent/error]', JSON.stringify(payload).slice(0, 2000));
});

// 子代理模式：记录 start/end 生命周期与子会话事件（跨会话聚合的最小验证）。
// continuable 后台委托：工具立即返回 started，子代理输出经 subagent/end 的
// lastAssistantMessage 回传，父会话后续回合再消费 report。
const subagentStarts = [];
const subagentEnds = [];
if (process.env.SMOKE_SUBAGENT === '1') {
  ctx.on('subagent/start', (info) => {
    subagentStarts.push(info);
  });
  ctx.on('subagent/end', (info) => {
    subagentEnds.push(info);
  });
}

/** 轮询等待条件成立（后台子代理的 end 事件晚于父回合 whenIdle）。 */
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

/** subagent/end 载荷的纯文本：lastAssistantMessage 是 content 块数组本身。 */
function subagentEndText(info) {
  const blocks = info?.lastAssistantMessage;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

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

const firstComposition = await composeAgent();
const firstHandle = await ctx.agents.create({
  sessionId: 'smoke-session',
  meta: {
    cwd: projectRoot,
    ...(firstComposition.agentPreset !== undefined
      ? { agentPreset: firstComposition.agentPreset }
      : {}),
  },
  ...(firstComposition.setup !== undefined ? { setup: firstComposition.setup } : {}),
  agentOptions: ctx.agentDefaultModel.currentSelection(),
});
const agent = firstHandle.agent;
agent.followup(
  createUserMessage({ content: [{ type: 'text', text: '你好，请回复冒烟确认。' }], source: { kind: 'user' } }),
);
await agent.whenIdle();

if (process.env.SMOKE_DEBUG === '1') {
  const live = events.find((e) => e.type === 'user/message');
  console.error('live user/message:', JSON.stringify(live)?.slice(0, 600));
  for (const e of events.filter((e) => e.type === 'turn/end' || e.type === 'assistant/chunk' || e.type === 'request/header')) {
    console.error(`[debug ${e.type}]`, JSON.stringify(e)?.slice(0, 1200));
  }
}

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
} else if (process.env.SMOKE_SUBAGENT === '1') {
  // continuable 委托：先等子代理跑完（end 事件），再验生命周期与输出。
  const ended = await waitFor(() => subagentEnds.length > 0, 20_000);
  if (!ended) failure = '等待 subagent/end 超时（子代理未运行或未结束）';
  else if (!toolCalls.some((e) => e.data.name === 'subagent')) failure = '没有 subagent 工具调用';
  else if (toolResults.some((e) => e.data.error !== undefined)) failure = 'subagent 工具结果带错误';
  else if (subagentStarts.length === 0) failure = '没有收到 subagent/start 事件';
  else if (subagentEnds[0]?.stopReason !== 'completed') {
    failure = `subagent/end 终止原因异常：${String(subagentEnds[0]?.stopReason)}`;
  } else if (!subagentEndText(subagentEnds[0]).includes('子代理回复')) {
    failure = `subagent/end 载荷中没有子代理输出：${subagentEndText(subagentEnds[0]).slice(0, 200)}`;
    console.error('[debug subagent/end]', JSON.stringify(subagentEnds[0])?.slice(0, 2000));
  }
} else if (textDeltas.length === 0) failure = '没有收到 assistant/chunk text-delta 流';
else if (finalMessages.length === 0) failure = '没有收到 assistant/message 最终消息';
else if (finalText.length === 0) failure = '最终消息没有文本内容';
else if (turnEnds.length === 0) failure = '没有收到 turn/end';

// 子代理模式附加：子会话应已持久化（origin=subagent + parentSession）。
let childHeader;
if (failure === undefined && process.env.SMOKE_SUBAGENT === '1') {
  const listed = await ctx.sessionPersistence.list();
  childHeader = listed.find((header) => header.origin === 'subagent');
  if (childHeader === undefined) failure = '持久化列表中没有 origin=subagent 的子会话';
  else if (childHeader.parentSession !== 'smoke-session') {
    failure = `子会话 parentSession 异常：${String(childHeader.parentSession)}`;
  }
}

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
if (process.env.SMOKE_SUBAGENT === '1') {
  console.log(`  subagent: start ${subagentStarts.length} 次, end ${subagentEnds.length} 次`);
  console.log(`  子会话: ${childHeader?.id ?? '(无)'} (parent=${String(childHeader?.parentSession)})`);
}

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

// 恢复按会话记录的预设重建（resolveSessionPreset：事件 last-wins > 头）。
const resumedComposition = await composeAgent(resolveSessionPreset(inspection));
const resumed = await ctx.agents.resume({
  resumeSessionId: 'smoke-session',
  agentOptions: ctx.agentDefaultModel.currentSelection(),
  ...(resumedComposition.setup !== undefined ? { setup: resumedComposition.setup } : {}),
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

// ---- 派生会话（fork，SMOKE_FORK=1）：completed-turn seed → 新会话继承历史 ----
// 与主进程 HarnessService.forkSession 相同的种子语义（对齐 subagent-fork
// 的 completedTurnPrefix）：截到最后一个 turn/end，新会话是普通顶层会话。
if (process.env.SMOKE_FORK === '1') {
  const forkEvents = [];
  ctx.on('session/event', (session, event) => {
    if (session.id === 'smoke-fork') forkEvents.push(event);
  });
  const parent = await ctx.sessionPersistence.inspect('smoke-session');
  const lastEndIndex = parent.events.findLastIndex((e) => e.type === 'turn/end');
  if (lastEndIndex === -1) {
    console.error('SMOKE FAIL(fork): 父会话没有已完成回合');
    await ctx.fiber.dispose().catch(() => {});
    rmSync(process.env.DSH_HOME, { recursive: true, force: true });
    process.exit(1);
  }
  const seed = parent.events.slice(0, lastEndIndex + 1);
  // fork 继承父会话实际运行的预设（非空白：创建时挂载即定档）。
  const forkComposition = await composeAgent(resolveSessionPreset(parent));
  const forkHandle = await ctx.agents.create({
    sessionId: 'smoke-fork',
    meta: {
      cwd: projectRoot,
      ...(forkComposition.agentPreset !== undefined
        ? { agentPreset: forkComposition.agentPreset }
        : {}),
    },
    seed,
    ...(forkComposition.setup !== undefined ? { setup: forkComposition.setup } : {}),
    agentOptions: ctx.agentDefaultModel.currentSelection(),
  });
  forkHandle.agent.followup(
    createUserMessage({ content: [{ type: 'text', text: '派生后继续：请回复。' }], source: { kind: 'user' } }),
  );
  await forkHandle.agent.whenIdle();

  const forkInspection = await ctx.sessionPersistence.inspect('smoke-fork');
  // user/message 的持久化形态：消息字段在 data 根上（content/source/...）。
  const forkReplayText = forkInspection.events
    .filter((e) => e.type === 'user/message' && e.data?.content !== undefined)
    .flatMap((e) => e.data.content.filter((b) => b?.type === 'text').map((b) => b.text))
    .join('\n');
  const forkEnded = forkEvents.some((e) => e.type === 'turn/end');
  if (!forkReplayText.includes('你好，请回复冒烟确认')) {
    console.error('SMOKE FAIL(fork): 派生会话没有继承父会话历史');
    console.error('派生回放 user 文本:', forkReplayText.slice(0, 200));
    console.error(
      '派生会话事件分布:',
      forkInspection.events.map((e) => e.type).join(', ') || '(无)',
    );
    const sample = forkInspection.events.find((e) => e.type === 'user/message');
    console.error('user/message 样例:', JSON.stringify(sample)?.slice(0, 800));
    await forkHandle.dispose().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
    rmSync(process.env.DSH_HOME, { recursive: true, force: true });
    process.exit(1);
  }
  if (!forkEnded) {
    console.error('SMOKE FAIL(fork): 派生会话新回合没有 turn/end');
    await forkHandle.dispose().catch(() => {});
    await ctx.fiber.dispose().catch(() => {});
    rmSync(process.env.DSH_HOME, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`  派生会话继承事件 ${seed.length} 条，新回合正常完成`);
  console.log('SMOKE PASS(fork)');
  await forkHandle.dispose().catch(() => {});
}

await ctx.fiber.dispose().catch(() => {});
rmSync(process.env.DSH_HOME, { recursive: true, force: true });
