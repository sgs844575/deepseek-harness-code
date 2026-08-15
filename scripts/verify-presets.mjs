/**
 * Agent 预设挂载校验：以与主进程相同的方式 boot 宿主组合，遍历 roster
 * 名单，逐个 preset 走 standingKeyFor（解析 + 常驻挂载，不启动任何
 * agent / 会话 / 回合）。挂载审计会拒绝：等待缺失服务的行、泄漏到根
 * realm 的服务行、导入失败的行——因此本脚本是预设文件编辑后的一键体检。
 *
 * 用法：node scripts/verify-presets.mjs
 * 退出码 0 = 全部可挂载（broken 名单为空）；非 0 = 有预设挂载失败。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const harnessRoot = path.join(projectRoot, 'deepseek-harness');

process.env.DSH_HOME = mkdtempSync(path.join(tmpdir(), 'dshc-preset-home-'));
process.env.DSH_CWD = projectRoot;
process.env.DSH_HARNESS_ROOT = harnessRoot;
process.env.DSH_CONFIG_DIR = path.join(projectRoot, 'config', 'harness');

const { boot } = await import(
  new URL(`file:///${path.join(harnessRoot, 'packages', 'boot', 'app-boot', 'lib', 'index.js').replaceAll('\\', '/')}`).href
);

const ctx = await boot('dshc-preset-verify', path.join(projectRoot, 'config', 'harness', 'cordis.yml'));
const presets = ctx.agentPresets;
if (presets === undefined) {
  console.error('VERIFY FAIL: 组合未挂载 agent-presets roster');
  process.exit(1);
}

console.log(`roster 默认预设：${presets.defaultId}`);
let failures = 0;
for (const preset of await presets.list()) {
  const label = `${preset.id}（${preset.name ?? preset.id}${preset.trust === 'user' ? '，自建' : ''}）`;
  if (preset.broken !== undefined) {
    console.error(`✗ ${label} 发现期即损坏：${preset.broken}`);
    failures += 1;
    continue;
  }
  try {
    await presets.standingKeyFor(preset.id);
    console.log(`✓ ${label} 挂载成功`);
  } catch (error) {
    console.error(`✗ ${label} 挂载失败：${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  }
}

// 空白会话切换链路：plugin 创建（setup 挂载）→ recompose 到 standard →
// agent-preset/selected 事件 → 持久化头与事件解析一致。不发 prompt，
// agent 懒启动不产生任何 LLM 请求。
try {
  const created = await composeAndCreate('verify-switch');
  await presets.recompose(created.agent.ctx, 'standard');
  await created.agent.session.append('agent-preset/selected', { agentPreset: 'standard' });
  await created.dispose();
  const inspection = await ctx.sessionPersistence.inspect('verify-switch');
  const selected = [...inspection.events]
    .reverse()
    .find((event) => event.type === 'agent-preset/selected');
  if (inspection.meta.agentPreset !== 'plugin') {
    throw new Error(`创建头预设异常：${String(inspection.meta.agentPreset)}`);
  }
  if (selected?.data?.agentPreset !== 'standard') {
    throw new Error(`切换事件缺失或异常：${JSON.stringify(selected)}`);
  }
  console.log('✓ 空白会话切换：plugin → standard（recompose + 事件记录 + 头/事件解析一致）');
} catch (error) {
  console.error(`✗ 空白会话切换失败：${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
}

/** 以默认预设创建一个懒 agent（与主进程 composeAgent + agents.create 同构）。 */
async function composeAndCreate(sessionId) {
  const resolved = await presets.resolve();
  return ctx.agents.create({
    sessionId,
    meta: { cwd: projectRoot, agentPreset: resolved.id },
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolved.id);
    },
  });
}

await ctx.fiber.dispose().catch(() => {});
rmSync(process.env.DSH_HOME, { recursive: true, force: true });
if (failures > 0) {
  console.error(`VERIFY FAIL: ${failures} 个预设不可用`);
  process.exit(1);
}
console.log('VERIFY PASS: 全部预设可挂载');
