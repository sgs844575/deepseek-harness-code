/**
 * subprocess-child —— 用 node:child_process 实现的 SubprocessRuntime 服务插件。
 *
 * 存在原因：官方 dsh-subprocess-local 在模块顶层静态 import node-pty，
 * 在 Electron 主进程内加载会因原生 ABI 不匹配直接崩溃。本插件以纯
 * child_process 实现同一 seam 契约（spawn / resolveExecutable），
 * 不提供 PTY（spawnTerminal 抛错，一期客户端不需要持久终端）。
 *
 * 语义对齐 deepseek-harness/packages/subprocess/subprocess/src/types.ts 的契约文档：
 * - spawn 立即返回句柄；done 在进程 close 时落定，仅 spawn 级失败 reject；
 * - collect 模式的读取是按偏移、不消费式的；管道流交给调用者；
 * - terminate（与 spec 的 abort signal）执行 SIGTERM → graceMs → SIGKILL 升级，
 *   Windows 用 taskkill /T 树级终止；
 * - 服务销毁时终止并等待全部仍在运行的被管进程。
 */

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, mkdtempSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleepMs } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ──────────────────────────── seam 契约类型（本地结构化镜像） ──────────────────────────── */

export interface SubprocessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface SubprocessCollect {
  maxBytes: number;
  spill?: { maxBytes: number };
}

export type SubprocessStdinMode = 'ignore' | 'pipe' | { readonly data: string };
export type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect;

export interface SubprocessSpawnSpec {
  argv: readonly string[];
  cwd: string;
  stdio: { stdin: SubprocessStdinMode; stdout: SubprocessOutputMode; stderr: SubprocessOutputMode };
  graceMs: number;
  signal?: AbortSignal | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export interface SubprocessOutputRead {
  text: string;
  nextOffset: number;
  lossy: boolean;
  spillPath?: string;
}

export interface SubprocessOutputReader {
  readFrom(fromByte: number): SubprocessOutputRead;
}

export interface SubprocessCollectedOutputs {
  readonly stdout?: SubprocessOutputReader;
  readonly stderr?: SubprocessOutputReader;
}

export interface SubprocessHandle {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream | undefined;
  readonly stdout: NodeJS.ReadableStream | undefined;
  readonly stderr: NodeJS.ReadableStream | undefined;
  readonly collected: SubprocessCollectedOutputs;
  readonly done: Promise<SubprocessOutcome>;
  terminate(): void;
  waitForExit(signal?: AbortSignal): Promise<boolean>;
}

export interface SubprocessTerminalSpawnSpec {
  argv: readonly string[];
  cwd: string;
  env?: Record<string, string> | undefined;
  rows: number;
  cols: number;
  graceMs: number;
  signal?: AbortSignal | undefined;
}

/** 单个 Node 定时器可表示的最大毫秒数。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/* ──────────────────────────── 环境清洗（对齐 seam 的 scrub 语义） ──────────────────────────── */

const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith('DSH_')) {
      env[key] = value;
    }
  }
  return env;
}

/** 显式条目合并到清洗后的父环境；Windows 按大小写不敏感键语义覆盖。 */
function childEnv(extra?: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const env = scrubbedParentEnv();
  if (process.platform !== 'win32') return { ...env, ...extra };
  let entries: [string, string | undefined][] = Object.entries(env);
  for (const [key, value] of Object.entries(extra ?? {})) {
    const normalized = key.toUpperCase();
    entries = entries.filter(([inherited]) => inherited.toUpperCase() !== normalized);
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/** 按 Windows 大小写不敏感语义读取环境键。 */
function envValue(env: NodeJS.ProcessEnv, name: 'PATH' | 'PATHEXT'): string | undefined {
  const exact = env[name];
  if (exact !== undefined || process.platform !== 'win32') return exact;
  const normalized = name.toUpperCase();
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1];
}

/* ──────────────────────────── 尾部保留收集器（带可选 spill 文件） ──────────────────────────── */

let spillCounter = 0;
let spillDirCache: string | undefined;

function privateSpillDir(): string {
  spillDirCache ??= mkdtempSync(join(tmpdir(), 'dshc-subprocess-'));
  return spillDirCache;
}

/** 有界内存尾部收集；溢出时（若配置 spill）把完整流落盘以便找回。 */
class OutputCollector implements SubprocessOutputReader {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private total = 0;
  private spillFd: number | undefined;
  private spillFile: string | undefined;
  private spillDisabled: boolean;

  constructor(
    private readonly maxBytes: number,
    private readonly maxSpillBytes: number | undefined,
    private readonly label: string,
  ) {
    this.spillDisabled = maxSpillBytes === undefined;
  }

  push(chunk: Buffer): void {
    this.total += chunk.length;
    const overflows = this.bytes + chunk.length > this.maxBytes;
    if (!this.spillDisabled && (overflows || this.spillFd !== undefined)) this.spillAll(chunk);
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0] as Buffer;
      const excess = this.bytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.bytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
    }
  }

  private spillAll(chunk: Buffer): void {
    if (this.maxSpillBytes !== undefined && this.total > this.maxSpillBytes) {
      this.discardSpill();
      return;
    }
    if (this.spillFd === undefined) {
      this.spillFile = join(
        privateSpillDir(),
        `dshc-${process.pid}-${++spillCounter}-${this.label}.log`,
      );
      this.spillFd = openSync(this.spillFile, 'wx', 0o600);
      for (const prior of this.chunks) writeSync(this.spillFd, prior);
    }
    writeSync(this.spillFd, chunk);
  }

  private discardSpill(): void {
    const fd = this.spillFd;
    const file = this.spillFile;
    this.spillFd = undefined;
    this.spillFile = undefined;
    this.spillDisabled = true;
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        this.spillFd = fd; // 保留句柄让 seal 重试
      }
    }
    if (file !== undefined) {
      try {
        unlinkSync(file);
      } catch {
        // 失败的 unlink 至多留下 maxSpillBytes 的残留，不会无限增长。
      }
    }
  }

  readFrom(fromByte: number): SubprocessOutputRead {
    const windowStart = this.total - this.bytes;
    const buffer = Buffer.concat(this.chunks);
    const lossy = fromByte < windowStart;
    const slice = lossy ? buffer : buffer.subarray(fromByte - windowStart);
    return {
      text: slice.toString('utf8'),
      nextOffset: this.total,
      lossy,
      ...(this.spillFile !== undefined ? { spillPath: this.spillFile } : {}),
    };
  }

  /** 流结束后封盘 spill 文件；关闭失败则不再对外提供该路径。 */
  seal(): void {
    if (this.spillFd === undefined) return;
    try {
      closeSync(this.spillFd);
    } catch {
      this.spillFile = undefined;
    }
    this.spillFd = undefined;
  }
}

/* ──────────────────────────── 进程树终止 ──────────────────────────── */

/** Windows 树级强杀；竞态失败（树已消失等）按幂等吞掉。 */
function taskkillProcessTree(pid: number): void {
  if (pid <= 0) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

/** 平台正确的树级信号：POSIX 发给分离进程组（失败回退直接子进程），Windows taskkill。 */
function signalTree(pid: number, sig: NodeJS.Signals, child: { kill(sig?: NodeJS.Signals): void }): void {
  if (process.platform === 'win32') {
    taskkillProcessTree(pid);
    return;
  }
  if (pid <= 0) return;
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      // 子进程已退出；终止保持幂等。
    }
  }
}

/* ──────────────────────────── spawn 核心实现 ──────────────────────────── */

interface ManagedHandle extends SubprocessHandle {
  /** 同步最终终止（宿主退出路径），不启动定时器。 */
  terminateForHostExit(): void;
}

function spawnManagedProcess(spec: SubprocessSpawnSpec): ManagedHandle {
  if (!Number.isFinite(spec.graceMs) || spec.graceMs <= 0 || spec.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs 必须为不超过 ${MAX_TIMER_DELAY_MS} 的正有限数`);
  }
  if (spec.signal?.aborted) {
    throw new Error(`aborted before spawn: ${String(spec.signal.reason ?? 'aborted')}`);
  }
  const [program, ...args] = spec.argv;
  if (program === undefined || program.length === 0) {
    throw new Error('invalid argv: argv[0] 必须是非空程序名');
  }

  const isCollect = (mode: SubprocessOutputMode): mode is SubprocessCollect =>
    mode !== 'pipe' && mode !== 'inherit';
  const stdinMode = spec.stdio.stdin;
  const outMode = spec.stdio.stdout;
  const errMode = spec.stdio.stderr;

  const child = spawn(program, args, {
    cwd: spec.cwd,
    env: childEnv(spec.env),
    stdio: [
      stdinMode === 'ignore' ? 'ignore' : 'pipe',
      outMode === 'inherit' ? 'inherit' : 'pipe',
      errMode === 'inherit' ? 'inherit' : 'pipe',
    ],
    // POSIX 用分离进程组做树根；Windows 由 taskkill /T 按 pid 树终止。
    detached: process.platform !== 'win32',
  });

  const collectStream = (
    mode: SubprocessOutputMode,
    stream: NodeJS.ReadableStream | null,
    label: string,
  ): OutputCollector | undefined => {
    if (!isCollect(mode) || stream === null) return undefined;
    const collector = new OutputCollector(mode.maxBytes, mode.spill?.maxBytes, label);
    stream.on('data', (chunk: Buffer) => {
      collector.push(chunk);
    });
    return collector;
  };
  const stdoutCollector = collectStream(outMode, child.stdout, 'stdout');
  const stderrCollector = collectStream(errMode, child.stderr, 'stderr');

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let treeExitObserved = false;
  let treeExitObservation: Promise<void> | undefined;
  let settled = false;

  const pid = child.pid ?? -1;

  const treeAlive = (): boolean => {
    if (treeExitObserved || pid <= 0) return false;
    if (process.platform === 'win32') {
      // Windows 无进程组探活；直接子进程的退出即可观测边界（taskkill /T 已带走整树）。
      return child.exitCode === null && child.signalCode === null;
    }
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
      return child.exitCode === null && child.signalCode === null;
    }
  };

  const observeTreeExit = (): Promise<void> => {
    treeExitObservation ??= (async () => {
      while (treeAlive()) await sleepMs(15);
      treeExitObserved = true;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      graceTimer = undefined;
    })();
    return treeExitObservation;
  };

  const kill = (sig: NodeJS.Signals): void => {
    if (!treeAlive()) return;
    signalTree(pid, sig, child);
  };

  const terminate = (): void => {
    if (treeExitObserved || graceTimer !== undefined) return;
    void observeTreeExit();
    if (treeExitObserved) return;
    kill('SIGTERM');
    // 升级定时器必须在直接子进程落定后仍存活（领导者死亡不代表树死亡）。
    graceTimer = setTimeout(() => {
      kill('SIGKILL');
    }, spec.graceMs);
  };

  const onAbort = (): void => {
    terminate();
  };
  spec.signal?.addEventListener('abort', onAbort, { once: true });

  // 批量 stdin：写入并关闭；退出码与输出才是权威结果，写失败（EPIPE）尽力而为。
  if (typeof stdinMode === 'object' && child.stdin !== null) {
    child.stdin.on('error', () => {});
    child.stdin.end(stdinMode.data);
  }

  const done = new Promise<SubprocessOutcome>((resolveDone, rejectDone) => {
    let pipeDrainTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (stdoutCollector !== undefined) child.stdout?.destroy();
      if (stderrCollector !== undefined) child.stderr?.destroy();
      stdoutCollector?.seal();
      stderrCollector?.seal();
      if (pipeDrainTimer !== undefined) clearTimeout(pipeDrainTimer);
      spec.signal?.removeEventListener('abort', onAbort);
      resolveDone({ exitCode, signal });
    };
    child.on('error', (error) => {
      settled = true;
      if (pipeDrainTimer !== undefined) clearTimeout(pipeDrainTimer);
      spec.signal?.removeEventListener('abort', onAbort);
      rejectDone(error);
    });
    child.on('exit', (exitCode, signal) => {
      // 继承了管道的存活后代不能无限期阻塞结果：以同样的 grace 限制 close 等待。
      pipeDrainTimer = setTimeout(() => {
        settle(exitCode, signal);
      }, spec.graceMs);
    });
    child.on('close', (exitCode, signal) => {
      settle(exitCode, signal);
    });
  });

  const waitForExit = async (signal?: AbortSignal): Promise<boolean> => {
    const observed = observeTreeExit();
    if (treeExitObserved) return true;
    if (signal?.aborted) return false;
    if (signal === undefined) {
      await observed;
      return true;
    }
    const aborted = Promise.withResolvers<boolean>();
    const onWaitAbort = (): void => {
      aborted.resolve(false);
    };
    signal.addEventListener('abort', onWaitAbort, { once: true });
    if (signal.aborted) onWaitAbort();
    try {
      return await Promise.race([observed.then(() => true), aborted.promise]);
    } finally {
      signal.removeEventListener('abort', onWaitAbort);
    }
  };

  return {
    pid,
    stdin: stdinMode === 'pipe' ? child.stdin ?? undefined : undefined,
    stdout: outMode === 'pipe' ? child.stdout ?? undefined : undefined,
    stderr: errMode === 'pipe' ? child.stderr ?? undefined : undefined,
    collected: {
      ...(stdoutCollector !== undefined ? { stdout: stdoutCollector } : {}),
      ...(stderrCollector !== undefined ? { stderr: stderrCollector } : {}),
    },
    done,
    terminate,
    terminateForHostExit: () => {
      kill('SIGKILL');
    },
    waitForExit,
  };
}

/* ──────────────────────────── seam 基类加载与插件类 ──────────────────────────── */

/** Cordis 上下文中本插件用到的最小结构。 */
interface CordisContext {
  effect(setup: () => unknown, label?: string): unknown;
}

/** 动态加载的 seam 基类实例形状（即本类需要实现的抽象方法）。 */
type SubprocessRuntimeInstance = {
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string>;
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
  spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<unknown>;
};

type SubprocessRuntimeCtor = abstract new (ctx: CordisContext) => SubprocessRuntimeInstance;

/** 解析 harness 根目录：优先 DSH_HARNESS_ROOT；否则从本插件位置回溯项目根。 */
function resolveHarnessRoot(): string {
  const fromEnv = process.env.DSH_HARNESS_ROOT;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  // 本文件位于 <项目根>/config/harness/plugins/subprocess-child/
  const here = fileURLToPath(import.meta.url);
  return resolve(here, '..', '..', '..', '..', '..', 'deepseek-harness');
}

const seamModuleUrl = pathToFileURL(
  join(resolveHarnessRoot(), 'packages', 'subprocess', 'subprocess', 'lib', 'index.js'),
).href;

// 以绝对 file URL 加载 seam 基类：绕过包管理器解析，且与 harness 运行时共享同一模块实例
// （pnpm 软链 realpath 与此路径指向同一文件，ESM 缓存键一致）。
const Seam = (await import(seamModuleUrl)) as { SubprocessRuntime: SubprocessRuntimeCtor };

/**
 * child_process 版 subprocess 服务：注册为 ctx.subprocess。
 */
export default class ChildSubprocessRuntime extends Seam.SubprocessRuntime {
  private readonly live = new Set<ManagedHandle>();

  constructor(ctx: CordisContext) {
    super(ctx as never);
    ctx.effect(() => {
      const onHostExit = (): void => {
        for (const handle of this.live) {
          try {
            handle.terminateForHostExit();
          } catch {
            // 宿主退出路径无法逐个上报；继续处理其余进程。
          }
        }
      };
      process.prependListener('exit', onHostExit);
      return async () => {
        process.off('exit', onHostExit);
        await this.disposeManagedProcesses();
      };
    }, 'subprocess-child teardown');
  }

  private async disposeManagedProcesses(): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const handle of this.live) {
      handle.terminate();
      pending.push(handle.done.catch(() => {}).then(() => handle.waitForExit()));
    }
    await Promise.allSettled(pending);
    this.live.clear();
  }

  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-child: 可执行文件名不能为空');
    signal?.throwIfAborted();
    const environment = childEnv(env);
    const absolute = isAbsolute(command);
    if (!absolute && (command.includes('/') || (process.platform === 'win32' && command.includes('\\')))) {
      throw new Error(
        `subprocess-child: ${JSON.stringify(command)} 是相对路径；请使用绝对路径或裸 PATH 名称`,
      );
    }
    const candidates = absolute ? [command] : this.executableCandidates(command, environment);
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants.X_OK);
        signal?.throwIfAborted();
        return candidate;
      } catch {
        // 尝试下一个 PATH 候选；全部未命中时在末尾给出稳定错误。
      }
    }
    signal?.throwIfAborted();
    throw new Error(
      absolute
        ? `subprocess-child: ${JSON.stringify(command)} 不是可执行文件`
        : `subprocess-child: ${JSON.stringify(command)} 未在 PATH 上找到`,
    );
  }

  private executableCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
    const pathValue = envValue(env, 'PATH') ?? '';
    const extensions =
      process.platform === 'win32' && extname(command) === ''
        ? (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';')
        : [''];
    return pathValue.split(delimiter).flatMap((directory) =>
      extensions.map((extension) => resolve(process.cwd(), directory, command + extension)),
    );
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = spawnManagedProcess(spec);
    this.live.add(handle);
    // 整树退出后才释放所有权（存活的后代仍可被升级终止）。
    const release = (): void => {
      void handle.waitForExit().then(() => {
        this.live.delete(handle);
      });
    };
    handle.done.then(release, release);
    return handle;
  }

  async spawnTerminal(): Promise<never> {
    throw new Error(
      'subprocess-child: 持久终端（PTY）由二期提供；当前构建不支持 spawnTerminal',
    );
  }
}

/** 兼容具名导入的别名。 */
export const ChildSubprocessRuntimePlugin = ChildSubprocessRuntime;
