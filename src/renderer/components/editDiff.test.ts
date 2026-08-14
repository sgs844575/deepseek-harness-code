import { describe, expect, it } from 'vitest';
import { buildEditDiff, isEditTool } from './editDiff';

describe('editDiff', () => {
  it('str_replace 拆出删行与增行（CRLF 归一）', () => {
    const diff = buildEditDiff(
      'str_replace_editor',
      JSON.stringify({
        command: 'str_replace',
        path: 'D:/proj/src/a.ts',
        old_str: 'const a = 1;\r\nconst b = 2;',
        new_str: 'const a = 3;',
      }),
    );
    expect(diff).toEqual({
      path: 'D:/proj/src/a.ts',
      command: 'str_replace',
      del: ['const a = 1;', 'const b = 2;'],
      add: ['const a = 3;'],
    });
  });

  it('new_str 为空的 str_replace 是纯删除；create 全为增行', () => {
    const del = buildEditDiff(
      'str_replace_editor',
      JSON.stringify({ command: 'str_replace', path: '/x', old_str: 'line', new_str: '' }),
    );
    expect(del?.del).toEqual(['line']);
    expect(del?.add).toEqual([]);

    const create = buildEditDiff(
      'str_replace_editor',
      JSON.stringify({ command: 'create', path: '/x/new.ts', file_text: 'a\nb' }),
    );
    expect(create).toEqual({ path: '/x/new.ts', command: 'create', del: [], add: ['a', 'b'] });
  });

  it('view 等只读命令、非 edit 工具、坏 JSON 均返回 null', () => {
    expect(
      buildEditDiff('str_replace_editor', JSON.stringify({ command: 'view', path: '/x' })),
    ).toBeNull();
    expect(buildEditDiff('pwsh', '{"command":"str_replace"}')).toBeNull();
    expect(buildEditDiff('str_replace_editor', 'not-json')).toBeNull();
  });

  it('isEditTool 识别 edit 家族工具名', () => {
    expect(isEditTool('str_replace_editor')).toBe(true);
    expect(isEditTool('edit')).toBe(true);
    expect(isEditTool('pwsh')).toBe(false);
  });
});
