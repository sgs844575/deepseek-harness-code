import { describe, expect, it } from 'vitest';
import { toolGlyphKind, toolSummary } from './toolSummary';

describe('toolSummary', () => {
  it('pwsh：已执行 + 命令（多行折叠为单行、超长截断）', () => {
    expect(toolSummary('pwsh', JSON.stringify({ command: 'Write-Output ok' }))).toBe(
      '已执行 Write-Output ok',
    );
    const long = toolSummary('pwsh', JSON.stringify({ command: `x`.repeat(300) }));
    expect(long.startsWith('已执行 ')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual('已执行 '.length + 111);
    expect(toolSummary('pwsh', JSON.stringify({ command: 'a\nb' }))).toBe('已执行 a b');
    // 参数解析失败回落。
    expect(toolSummary('pwsh', 'not-json')).toBe('执行命令');
  });

  it('文件类工具：读 / 写 / 编辑动词 + 路径', () => {
    expect(toolSummary('read', JSON.stringify({ file_path: 'D:/a/b.ts' }))).toBe('读取 D:/a/b.ts');
    expect(toolSummary('write', JSON.stringify({ file_path: 'D:/a/b.ts' }))).toBe('写入 D:/a/b.ts');
    expect(
      toolSummary('str_replace_editor', JSON.stringify({ command: 'create', path: 'D:/new.ts' })),
    ).toBe('创建 D:/new.ts');
    expect(
      toolSummary('str_replace_editor', JSON.stringify({ command: 'str_replace', path: 'D:/x.ts' })),
    ).toBe('编辑 D:/x.ts');
    expect(
      toolSummary('str_replace_editor', JSON.stringify({ command: 'view', path: 'D:/x.ts' })),
    ).toBe('查看 D:/x.ts');
  });

  it('搜索 / 子代理 / MCP / 其他', () => {
    expect(toolSummary('glob', JSON.stringify({ pattern: 'src/**/*.ts' }))).toBe(
      '搜索文件 src/**/*.ts',
    );
    expect(toolSummary('grep', JSON.stringify({ pattern: 'reasoning' }))).toBe('搜索内容 reasoning');
    expect(toolSummary('subagent', JSON.stringify({ description: '调研模块' }))).toBe(
      '子代理 · 调研模块',
    );
    expect(toolSummary('mcp__memory__search', '{}')).toBe('memory · search');
    expect(toolSummary('unknown_tool', '{}')).toBe('unknown_tool');
    expect(toolSummary('todo', '[]')).toBe('更新任务列表');
  });
});

describe('toolGlyphKind', () => {
  it('按工具类别选择图标', () => {
    expect(toolGlyphKind('pwsh')).toBe('terminal');
    expect(toolGlyphKind('grep')).toBe('search');
    expect(toolGlyphKind('str_replace_editor')).toBe('edit');
    expect(toolGlyphKind('read')).toBe('file');
    expect(toolGlyphKind('subagent_fork')).toBe('agent');
    expect(toolGlyphKind('mcp__a__b')).toBe('mcp');
    expect(toolGlyphKind('whatever')).toBe('default');
  });
});
