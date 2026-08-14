#!/usr/bin/env node
/**
 * 一键发布打包（Windows）：node scripts/build-release.mjs
 *
 * 产物：release/deepseek-harness-code-v<version>-win-x64.zip，内容：
 *   deepseek-harness-code-win32-x64/
 *   ├─ deepseek-harness-code.exe        forge package 产物（asar:false）
 *   ├─ setup.cmd                        首次运行前安装 harness 运行时依赖
 *   └─ resources/app/
 *      ├─ .vite/ + node_modules/        客户端本体（forge 已 rebuild 原生模块）
 *      ├─ config/harness/               cordis.yml + 自写插件编译产物
 *      └─ deepseek-harness/             vendored harness 源码 + lib 产物（不含 node_modules）
 *
 * 路径约定与 src/main/harness/paths.ts 一致：运行时以 app.getAppPath() 为根做
 * path.join 定位 config 与 harness 树，因此关闭 asar、以真实目录随包分发即可，
 * 无需改动路径代码。harness 的 node_modules（pnpm 工作区，体积大且含平台相关
 * 原生模块）不进包，由 setup.cmd 在用户侧执行
 * `pnpm install --ignore-scripts --prod` 重建（仅需生产依赖，lib 产物已随包）。
 *
 * 调试：SKIP_FORGE=1 跳过 forge package，复用上一次 out/ 产物重跑拷贝/压缩。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const appName = pkg.name; // forge 输出目录 <name>-win32-x64
const packDirName = `${appName}-win32-x64`;
const outDir = path.join(root, 'out');
const releaseDir = path.join(root, 'release');
const packRoot = path.join(outDir, packDirName);
const appRes = path.join(packRoot, 'resources', 'app');

const log = (msg) => console.log(`[release] ${msg}`);
const run = (cmd, cwd = root) => {
  log(cmd);
  execSync(cmd, { stdio: 'inherit', cwd, shell: true });
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
// 1) 编译自写 harness 插件 → 2) forge package
// ---------------------------------------------------------------------------
run('npm run build:harness');
if (process.env.SKIP_FORGE !== '1') {
  fs.rmSync(outDir, { recursive: true, force: true });
  run('npx electron-forge package');
}
if (!fs.existsSync(path.join(packRoot, `${appName}.exe`))) {
  console.error(`[release] 未找到 ${packRoot}\\${appName}.exe，forge package 可能失败`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3) 拷贝 config 与 harness 树进 resources/app
// ---------------------------------------------------------------------------
log(`清理目标 ${appRes} 下的旧拷贝（config / deepseek-harness）…`);
fs.rmSync(path.join(appRes, 'config'), { recursive: true, force: true });
fs.rmSync(path.join(appRes, 'deepseek-harness'), { recursive: true, force: true });

fs.cpSync(path.join(root, 'config'), path.join(appRes, 'config'), { recursive: true });
log(`config/ 已拷贝（${mb(path.join(appRes, 'config'))} MB）`);

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
const harnessSrc = path.join(root, 'deepseek-harness');
const harnessDst = path.join(appRes, 'deepseek-harness');
fs.cpSync(harnessSrc, harnessDst, {
  recursive: true,
  filter: (src) => {
    if (src === harnessSrc) return true;
    return !harnessExcluded(path.relative(harnessSrc, src));
  },
});
log(`deepseek-harness/ 已拷贝（${mb(harnessDst)} MB，不含 node_modules）`);

// ---------------------------------------------------------------------------
// 4) setup.cmd：首次运行前重建 harness 生产依赖
// ---------------------------------------------------------------------------
const setupCmd = `@echo off
rem DeepSeek Harness Code 首次运行设置：安装 harness 运行时依赖（需 Node.js 22+ 与 pnpm）
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
echo [setup] 安装 harness 运行时依赖（仅生产依赖，可能需要几分钟）...
pushd "resources\app\deepseek-harness"
call pnpm install --ignore-scripts --prod
set INSTALL_RC=%errorlevel%
popd
if not "%INSTALL_RC%"=="0" (
  echo [setup] pnpm install 失败（退出码 %INSTALL_RC%），请检查网络后重试。
  pause
  exit /b %INSTALL_RC%
)
echo [setup] 完成！现在可以双击 ${appName}.exe 启动应用。
pause
`;
fs.writeFileSync(path.join(packRoot, 'setup.cmd'), setupCmd, 'utf8');
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
