/**
 * edit 工具（str_replace_editor）的 diff 视图构建。
 *
 * 纯函数：从工具调用的 arguments JSON 中解析出可渲染的增删行。
 * 只覆盖会产生内容变更的命令（str_replace / create / insert）；
 * view 等只读命令返回 null，走普通参数展示路径。
 */

export interface EditDiffView {
  /** 目标文件路径（相对展示，去掉工作区前缀由调用方决定，这里原样）。 */
  path: string;
  /** 命令名（展示用）。 */
  command: string;
  /** 删除的行（含上下文不完整时的整块 old_str）。 */
  del: string[];
  /** 新增的行。 */
  add: string[];
}

/** 命中这些工具名时尝试 diff 渲染。 */
const EDIT_TOOL_NAMES = new Set(['str_replace_editor', 'edit']);

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function isEditTool(toolName: string): boolean {
  return EDIT_TOOL_NAMES.has(toolName);
}

export function buildEditDiff(toolName: string, argumentsText: string): EditDiffView | null {
  if (!isEditTool(toolName) || argumentsText.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(argumentsText);
    if (typeof value !== 'object' || value === null) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }

  const command = typeof parsed.command === 'string' ? parsed.command : '';
  const path = typeof parsed.path === 'string' ? parsed.path : '';
  const oldStr = typeof parsed.old_str === 'string' ? parsed.old_str : '';
  const newStr = typeof parsed.new_str === 'string' ? parsed.new_str : '';
  const fileText = typeof parsed.file_text === 'string' ? parsed.file_text : '';

  switch (command) {
    case 'str_replace':
      // new_str 为空 = 纯删除；old_str 为空不属于该命令的合法形态。
      if (oldStr.length === 0 && newStr.length === 0) return null;
      return { path, command, del: splitLines(oldStr), add: splitLines(newStr) };
    case 'create':
      if (fileText.length === 0) return null;
      return { path, command, del: [], add: splitLines(fileText) };
    case 'insert':
      if (newStr.length === 0) return null;
      return { path, command, del: [], add: splitLines(newStr) };
    default:
      return null;
  }
}
