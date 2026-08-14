import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppSettingsStore,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from './app-settings-store.js';

describe('normalizeAppSettings', () => {
  it('空输入回落全套默认值', () => {
    expect(normalizeAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(normalizeAppSettings('garbage')).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('合法字段保留，未知/非法字段回落默认', () => {
    const normalized = normalizeAppSettings({
      terminalShell: 'powershell',
      terminalShellFake: 'nope',
      closeToTray: true,
      interactionBehavior: 'steer',
      interactionBehaviorBad: 'xxx',
      archiveRetentionDays: 30,
    });
    expect(normalized.terminalShell).toBe('powershell');
    expect(normalized.closeToTray).toBe(true);
    expect(normalized.interactionBehavior).toBe('steer');
    expect(normalized.archiveRetentionDays).toBe(30);
    // 未提供的开关类字段回落默认（显式 false 语义不能被 undefined 吞掉）。
    expect(normalized.notifications).toBe(true);
    expect(normalized.autoContinueQuestions).toBe(false);
  });

  it('代理归一化：补 http:// 前缀、非法值清空', () => {
    expect(normalizeAppSettings({ httpProxy: 'http://127.0.0.1:7890' }).httpProxy).toBe(
      'http://127.0.0.1:7890',
    );
    expect(normalizeAppSettings({ httpProxy: '127.0.0.1:7890' }).httpProxy).toBe(
      'http://127.0.0.1:7890',
    );
    expect(normalizeAppSettings({ httpProxy: 'not a proxy' }).httpProxy).toBe('');
    expect(normalizeAppSettings({ httpProxy: '   ' }).httpProxy).toBe('');
  });

  it('归档保留时长钳制在 1–365 天', () => {
    expect(normalizeAppSettings({ archiveRetentionDays: 0 }).archiveRetentionDays).toBe(1);
    expect(normalizeAppSettings({ archiveRetentionDays: 9999 }).archiveRetentionDays).toBe(365);
    expect(normalizeAppSettings({ archiveRetentionDays: '14' }).archiveRetentionDays).toBe(14);
    expect(normalizeAppSettings({ archiveRetentionDays: 'x' }).archiveRetentionDays).toBe(7);
  });
});

describe('AppSettingsStore', () => {
  const dirs: string[] = [];

  const tempFile = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dshc-settings-'));
    dirs.push(dir);
    return path.join(dir, 'app-settings.json');
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件缺失时给默认值；update 合并、归一化并落盘', () => {
    const file = tempFile();
    const store = new AppSettingsStore(file);
    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS);

    const next = store.update({ httpProxy: '127.0.0.1:7890', keepAwake: true });
    expect(next.httpProxy).toBe('http://127.0.0.1:7890');
    expect(next.keepAwake).toBe(true);

    // 磁盘内容 = 归一化后的完整对象，重启后原样读回。
    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted).toEqual(next);
    expect(new AppSettingsStore(file).get()).toEqual(next);
  });

  it('脏文件（缺字段/坏类型）读入时被修复', () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ notifications: false, archiveRetentionDays: -3, junk: 1 }), 'utf8');
    const store = new AppSettingsStore(file);
    expect(store.get().notifications).toBe(false);
    expect(store.get().archiveRetentionDays).toBe(1);
    expect('junk' in store.get()).toBe(false);
  });

  it('update 通知订阅者', () => {
    const store = new AppSettingsStore(tempFile());
    const seen: unknown[] = [];
    const unsubscribe = store.subscribe((value) => seen.push(value));
    store.update({ showThinking: false });
    unsubscribe();
    store.update({ showThinking: true });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { showThinking: boolean }).showThinking).toBe(false);
  });
});
