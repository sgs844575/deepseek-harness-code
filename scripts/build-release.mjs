#!/usr/bin/env node
/**
 * 一键发布打包（Windows）：node scripts/build-release.mjs
 *
 * 产物：release/deepseek-harness-code-v<version>-win-x64.zip，内容：
 *   deepseek-harness-code-win32-x64/
 *   ├─ deepseek-harness-code.exe        forge package 产物（经典 asar 形态）
 *   ├─ setup.cmd                        首次运行前安装 harness 运行时依赖
 *   └─ resources/
 *      ├─ app.asar(+unpacked)           UI 壳：三路构建产物 + 运行时 node_modules
 *      ├─ config/harness/               cordis.yml + 自写插件编译产物（真实目录）
 *      └─ deepseek-harness/             harness 源码 + lib 产物 + 预装生产依赖（开箱即用）
 *
 * 布局约定（与 src/main/harness/paths.ts 一致）：
 *   - UI 进 asar；cordis.yml 与 harness 树以真实目录住 resources/ 下——运行时
 *     动态 import 的模块（boot/官方插件/seam）不进 asar。cordis.yml 里官方插件
 *     的 ../../deepseek-harness 相对前缀在本布局同样成立（config/harness 与
 *     deepseek-harness 同层住 resources/），无需重写。
 *   - 打包期 harness 树由 forge.config.ts 的 prePackage/postPackage 钩子暂出/
 *     移回仓库（OOM 根因修复），本脚本在 forge 完成后从仓库内取树拷贝。
 *
 * 开箱即用：harness 生产依赖在本脚本内预装进包（hoisted 平铺 + workspace 补链
 * + 删除 .pnpm 硬链接母本避免 zip 双份），终端用户解压即可运行——harness 进程
 * 内加载跑在 Electron 内嵌 Node 上，用户机器不需要 Node/pnpm。注意必须用 pnpm
 * 按 lockfile 装：pnpm-workspace.yaml 的 vendor overrides（cosmokit/schemastery
 * 指向 vendor/）与 node-pty 补丁 npm 都不认。setup.cmd 降级为修复工具。
 *
 * 调试：SKIP_FORGE=1 跳过 forge package；SKIP_DEPS=1 跳过依赖预装（快速迭代
 * 打包布局时用）。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const appName = pkg.name; // forge 输出目录 <name>-win32-x64
const packDirName = `${appName}-win32-x64`;
const outDir = path.join(root, 'out');
const releaseDir = path.join(root, 'release');
const packRoot = path.join(outDir, packDirName);
const resDir = path.join(packRoot, 'resources');

const log = (msg) => console.log(`[release] ${msg}`);
const run = (cmd, cwd = root, env = {}) => {
  log(cmd);
  execSync(cmd, { stdio: 'inherit', cwd, shell: true, env: { ...process.env, ...env } });
};
const mb = (p) => {
  let total = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.pnpm-store') continue;
      const q = path.join(dir, e.name);
      if (e.isDirectory()) walk(q);
      else total += fs.statSync(q).size;
    }
  };
  walk(p);
  return (total / 1048576).toFixed(1);
};

// ---------------------------------------------------------------------------
// harness 树源：仓库内 vendored 树（forge 钩子已移回）→ 打包中断残留的暂存
// ---------------------------------------------------------------------------
const harnessCandidates = [
  path.join(root, 'deepseek-harness'),
  path.resolve(root, '..', 'deepseek-harness.pack-stash'),
].filter((p) => fs.existsSync(path.join(p, 'packages')));
if (harnessCandidates.length === 0) {
  console.error('[release] 仓库内找不到 deepseek-harness 树（packages/ 缺失）。');
  process.exit(1);
}
const harnessSrc = harnessCandidates[0];
log(`harness 树源：${harnessSrc}`);
if (!fs.existsSync(path.join(harnessSrc, 'packages', 'boot', 'app-boot', 'lib', 'index.js'))) {
  console.error('[release] harness 缺少 lib 构建产物（packages/boot/app-boot/lib/index.js）。');
  console.error('           请先在 harness 树内执行构建（如 pnpm build:lib），再重试。');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) 编译自写 harness 插件 → 2) forge package
//    （默认堆即可：forge 钩子已把 harness 树暂出打包输入，不再需要
//    --max-old-space-size=8192 的 OOM 规避）
// ---------------------------------------------------------------------------
run('npm run build:harness');
if (process.env.SKIP_FORGE !== '1') {
  fs.rmSync(outDir, { recursive: true, force: true });
  run('npx electron-forge package', root);
}
if (!fs.existsSync(path.join(packRoot, `${appName}.exe`))) {
  console.error(`[release] 未找到 ${packRoot}\\${appName}.exe，forge package 可能失败`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3) 拷贝 config 与 harness 树到 resources/（真实目录，与 asar 平级）
// ---------------------------------------------------------------------------
fs.mkdirSync(resDir, { recursive: true });
log('清理 resources/ 下的旧拷贝（config / deepseek-harness）…');
fs.rmSync(path.join(resDir, 'config'), { recursive: true, force: true });
fs.rmSync(path.join(resDir, 'deepseek-harness'), { recursive: true, force: true });

fs.cpSync(path.join(root, 'config'), path.join(resDir, 'config'), { recursive: true });
log(`config/ 已拷贝（${mb(path.join(resDir, 'config'))} MB）`);

/** harness 树裁剪：保留 package.json / lib 产物 / lockfile / 根配置，
 *  排除安装期可重建或与运行无关的内容。src/tests 不进包（lib 已构建）。 */
const harnessExcluded = (rel) => {
  const segs = rel.split(path.sep);
  if (segs.includes('node_modules') || segs.includes('.pnpm-store')) return true;
  if (segs.includes('src') || segs.includes('tests')) return true;
  if (segs.includes('.github') || segs.includes('.agents') || segs.includes('coverage')) return true;
  const base = segs[segs.length - 1];
  if (base.endsWith('.tsbuildinfo')) return true;
  if (['.gitlab-ci.yml', '.gitattributes', '.gitignore'].includes(base)) return true;
  return false;
};
const harnessDst = path.join(resDir, 'deepseek-harness');
fs.cpSync(harnessSrc, harnessDst, {
  recursive: true,
  filter: (src) => {
    if (src === harnessSrc) return true;
    return !harnessExcluded(path.relative(harnessSrc, src));
  },
});
log(`deepseek-harness/ 已拷贝（${mb(harnessDst)} MB，不含 node_modules）`);

// ---------------------------------------------------------------------------
// 3.5) link-workspace-runtime.mjs：安装后把 workspace 包补链进根 node_modules
// ---------------------------------------------------------------------------
const linkScript = `#!/usr/bin/env node
/**
 * 将 harness 工作区的全部包链接进根 node_modules（等价 npm workspaces 行为）。
 * 为什么需要：各包把 workspace 运行时依赖（@deepseek-ai/cordis 等）声明为
 * peer/devDependency，\`pnpm install --prod\` 不建链接；运行期 lib 以真实路径
 * 直连加载，ESM 解析从包目录逐级上溯到根 node_modules——在根部补齐链接即可，
 * 且所有引用方拿到同一 realpath（cordis 单例语义）。
 * Windows 用 junction（免管理员权限），其他平台用目录符号链接。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nmRoot = path.join(root, 'node_modules');
const SKIP = new Set(['node_modules', '.pnpm-store', 'coverage']);

const projects = [];
const walk = (dir, depth) => {
  if (depth > 3) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (manifest.name) projects.push({ name: manifest.name, dir });
    } catch { /* 坏 manifest 跳过 */ }
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
    walk(path.join(dir, e.name), depth + 1);
  }
};
walk(root, 0);

const rootName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).name;
let created = 0;
let kept = 0;
let failed = 0;
for (const { name, dir } of projects) {
  if (name === rootName) continue;
  const dest = path.join(nmRoot, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) { kept += 1; continue; }
  try {
    fs.symlinkSync(path.resolve(dir), dest, process.platform === 'win32' ? 'junction' : 'dir');
    created += 1;
  } catch (error) {
    failed += 1;
    console.error(\`[link] 跳过 \${name}: \${error.message}\`);
  }
}
console.log(\`[link] workspace 链接完成：新建 \${created}，已存在 \${kept}，失败 \${failed}（共 \${projects.length} 个项目）\`);
`;
fs.writeFileSync(path.join(harnessDst, 'link-workspace-runtime.mjs'), linkScript, 'utf-8');
log('link-workspace-runtime.mjs 已生成');

// ---------------------------------------------------------------------------
// 3.6) 预装 harness 生产依赖（开箱即用；SKIP_DEPS=1 跳过）
// ---------------------------------------------------------------------------
const smokeScript = `/**
 * 运行时依赖闭环冒烟：以运行时同款方式 import 包内 boot 与关键插件，
 * 缺依赖立即失败。支持场景：发布脚本守卫 / 用户侧修复后自检。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const base = path.resolve(import.meta.dirname, 'packages');
const modules = [
  'boot/app-boot/lib/index.js',
  'llm/llm/lib/index.js',
  'llm/llm-deepseek/lib/index.js',
  'settings/settings-file/lib/index.js',
  'session/session-persistence-jsonl/lib/index.js',
  'examples/agent-spine-demo/lib/index.js',
  'subprocess/subprocess/lib/index.js',
  'interaction/user-approval/lib/index.js',
  'plan/plan-mode/lib/index.js',
];
for (const rel of modules) {
  await import(pathToFileURL(path.join(base, ...rel.split('/'))).href);
  console.log(\`IMPORT_OK \${rel}\`);
}
console.log('SMOKE_RUNTIME_OK');
`;
fs.writeFileSync(path.join(harnessDst, 'smoke-runtime-imports.mjs'), smokeScript, 'utf-8');
log('smoke-runtime-imports.mjs 已生成');

const sanitizeScript = `/**
 * 打包期 node_modules 卫生化：让整棵树对 zip/解压零链接依赖（仅打包机执行，
 * 用户侧无需运行）。
 * 1) 根 node_modules 里的 workspace 链接（junction）物化为真实目录拷贝——拷贝
 *    内容剔除目标内的 node_modules，链接循环（cordis↔plugin-loader）随之消失；
 * 2) 删除 harness 树内其余所有嵌套 node_modules（pnpm 为各 workspace 包建的
 *    逐包链接树，正是循环的来源；解析由根平铺布局承接）；
 * 3) 删除 node_modules/.bin（指向已删 .pnpm 的死链，运行期按路径 import 用不到）。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nm = path.join(root, 'node_modules');

let materialized = 0;
let prunedNested = 0;

const materializeLinks = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('@')) materializeLinks(p);
      continue;
    }
    if (!e.isSymbolicLink()) continue;
    const target = fs.realpathSync(p);
    const tmp = \`\${p}.__mat__\`;
    fs.mkdirSync(tmp);
    fs.cpSync(target, tmp, {
      recursive: true,
      filter: (src) => src === target || path.basename(src) !== 'node_modules',
    });
    fs.rmSync(p);
    fs.renameSync(tmp, p);
    materialized += 1;
  }
};
materializeLinks(nm);
fs.rmSync(path.join(nm, '.bin'), { recursive: true, force: true });

const pruneNested = (dir, depth) => {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (fs.existsSync(path.join(p, 'package.json'))) {
      const nested = path.join(p, 'node_modules');
      if (fs.existsSync(nested)) {
        fs.rmSync(nested, { recursive: true, force: true });
        prunedNested += 1;
      }
    }
    pruneNested(p, depth + 1);
  }
};
pruneNested(root, 0);

console.log(\`[sanitize] 物化根链接 \${materialized} 个；删除嵌套 node_modules \${prunedNested} 处\`);
`;
fs.writeFileSync(path.join(harnessDst, 'sanitize-node-modules.mjs'), sanitizeScript, 'utf-8');
log('sanitize-node-modules.mjs 已生成');

if (process.env.SKIP_DEPS !== '1') {
  // hoisted 平铺：写入副本的 pnpm-workspace.yaml——pnpm 11 不认 CLI 旗标，
  // .npmrc 对 node-linker 也无效，只有 workspace 文件生效（.modules.yaml 可证）。
  fs.appendFileSync(path.join(harnessDst, 'pnpm-workspace.yaml'), '\nnodeLinker: hoisted\n');
  // --prod 下 workspace-as-peer/devDep 的链接缺失由补链脚本兜底（见 3.5）。
  run('pnpm install --ignore-scripts --prod', harnessDst);
  run('node link-workspace-runtime.mjs', harnessDst);
  // hoisted 的顶层目录源自 .pnpm 硬链接母本；删除母本后顶层内容依旧完整
  // （硬链接语义），避免 zip 把每个依赖打包两份。
  fs.rmSync(path.join(harnessDst, 'node_modules', '.pnpm'), { recursive: true, force: true });
  log(`harness 生产依赖已预装（node_modules ${mb(path.join(harnessDst, 'node_modules'))} MB，已剔除 .pnpm）`);
  // 发布守卫：依赖闭环不绿不放行。
  run('node smoke-runtime-imports.mjs', harnessDst);

  // 卫生化：树内不允许残留任何链接——workspace 链接存在循环（cordis↔plugin），
  // zip 工具把 junction 当目录跟随会无限递归（bsdtar 报错、Compress-Archive
  // 静默跟随更危险）。物化根链接 + 删嵌套 node_modules 后再压缩；解析完整性
  // 由根平铺布局保证，随后的两次 smoke（卫生化后 + 解压后）兜底验证。
  run('node sanitize-node-modules.mjs', harnessDst);
  run('node smoke-runtime-imports.mjs', harnessDst);
}

// ---------------------------------------------------------------------------
// 4) setup.cmd：首次运行前重建 harness 生产依赖
// ---------------------------------------------------------------------------
const setupCmd = `@echo off
rem DeepSeek Harness Code 运行时修复工具（正常情况下无需运行：发布包已预装
rem harness 依赖，解压即可用）。仅当 resources\\deepseek-harness\\node_modules
rem 缺失或损坏导致启动报 "Cannot find package" 时使用（需要 Node.js 22+ 与 pnpm）。
setlocal
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if not errorlevel 1 (
    echo [setup] 未找到 pnpm，尝试 corepack enable pnpm ...
    call corepack enable pnpm >nul 2>nul
  )
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [setup] 缺少 pnpm。请先安装 Node.js 22+，然后执行：npm install -g pnpm
  pause
  exit /b 1
)
echo [setup] 重建 harness 运行时依赖（仅生产依赖，可能需要几分钟）...
pushd "resources\\deepseek-harness"
call pnpm install --ignore-scripts --prod
set INSTALL_RC=%errorlevel%
if not "%INSTALL_RC%"=="0" (
  popd
  echo [setup] pnpm install 失败（退出码 %INSTALL_RC%），请检查网络后重试。
  pause
  exit /b %INSTALL_RC%
)
rem workspace 包（@deepseek-ai/cordis 等）是 peer/devDependency 声明，
rem --prod 不会建链接，安装后必须补链到根 node_modules，否则启动报
rem "Cannot find package '@deepseek-ai/cordis'"。
node link-workspace-runtime.mjs
set INSTALL_RC=%errorlevel%
popd
if not "%INSTALL_RC%"=="0" (
  echo [setup] workspace 链接失败（退出码 %INSTALL_RC%）。
  pause
  exit /b %INSTALL_RC%
)
echo [setup] 完成！现在可以重新双击 ${appName}.exe 启动应用。
pause
`;
fs.writeFileSync(path.join(packRoot, 'setup.cmd'), setupCmd, 'utf-8');
log('setup.cmd 已生成');

// ---------------------------------------------------------------------------
// 5) 压缩为 zip：优先 bsdtar（Windows 10+ 自带），失败则退回 Compress-Archive
// ---------------------------------------------------------------------------
fs.mkdirSync(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, `deepseek-harness-code-v${version}-win-x64.zip`);
fs.rmSync(zipPath, { force: true });
try {
  run(`tar -a -cf "${zipPath}" -C "${outDir}" "${packDirName}"`);
} catch {
  log('bsdtar 不可用，改用 PowerShell Compress-Archive…');
  run(`powershell -NoProfile -Command "Compress-Archive -Path '${packRoot}' -DestinationPath '${zipPath}' -Force"`);
}
log(`✅ 发布包已生成：${zipPath}（${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB）`);

// ---------------------------------------------------------------------------
// 6) 解压复检：以最终用户视角验证 zip——解压到临时目录跑依赖闭环 smoke，
//    捕获链接物化/压缩过程引入的任何破损（SKIP_DEPS=1 时跳过）。
// ---------------------------------------------------------------------------
if (process.env.SKIP_DEPS !== '1') {
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dshc-zip-check-'));
  try {
    run(`tar -xf "${zipPath}" -C "${extractRoot}"`);
    run('node smoke-runtime-imports.mjs', path.join(extractRoot, packDirName, 'resources', 'deepseek-harness'));
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
  log('解压复检通过：zip 内运行时依赖闭环 OK（最终用户解压即用）');
}
