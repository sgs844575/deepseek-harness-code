/**
 * 工具调用 → 单行日志摘要（zcode / Claude Code 式工具行）。
 *
 * 纯函数：从工具调用的 arguments JSON 中尽力提取人类可读的动作描述
 * （pwsh 的命令、读写的文件路径、搜索的 pattern……），解析失败或
 * 未知工具时回落到工具名本身。长值截断，单行由 CSS ellipsis 收尾。
 */

/** 摘要中单个值的最大长度（超出以 … 截断）。 */
const VALUE_MAX_CHARS = 110;

function truncate(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > VALUE_MAX_CHARS
    ? `${singleLine.slice(0, VALUE_MAX_CHARS)}…`
    : singleLine;
}

function parseArguments(argumentsText: string): Record<string, unknown> {
  if (argumentsText.length === 0) return {};
  try {
    const value: unknown = JSON.parse(argumentsText);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/** 工具行图标类别（渲染层据此选线性图标）。 */
export type ToolGlyphKind =
  | 'terminal'
  | 'search'
  | 'file'
  | 'edit'
  | 'agent'
  | 'mcp'
  | 'todo'
  | 'question'
  | 'default';

export function toolGlyphKind(toolName: string): ToolGlyphKind {
  if (toolName === 'pwsh' || toolName === 'bash') return 'terminal';
  if (toolName === 'glob' || toolName === 'grep') return 'search';
  if (toolName === 'edit' || toolName === 'str_replace_editor' || toolName === 'write') return 'edit';
  if (toolName === 'read' || toolName === 'ls' || toolName === 'view') return 'file';
  if (toolName.startsWith('subagent') || toolName === 'send_message' || toolName === 'interrupt_agent' || toolName === 'list_agents') {
    return 'agent';
  }
  if (toolName.startsWith('mcp__')) return 'mcp';
  if (toolName === 'todo') return 'todo';
  if (toolName === 'ask_user_question' || toolName === 'exit_plan_mode') return 'question';
  return 'default';
}

/** 工具调用摘要（不含状态；状态由渲染层追加）。 */
export function toolSummary(toolName: string, argumentsText: string): string {
  const args = parseArguments(argumentsText);
  // MCP 工具：server · tool（去掉 mcp__ 前缀后按命名空间拆分）。
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.slice(5).split('__');
    return parts.length >= 2 ? `${parts[0]} · ${parts.slice(1).join('_')}` : toolName;
  }
  switch (toolName) {
    case 'pwsh':
    case 'bash': {
      const command = str(args, 'command');
      return command.length > 0 ? `已执行 ${truncate(command)}` : '执行命令';
    }
    case 'read':
      return `读取 ${truncate(str(args, 'file_path') || str(args, 'path')) || '文件'}`;
    case 'write':
      return `写入 ${truncate(str(args, 'file_path') || str(args, 'path')) || '文件'}`;
    case 'ls':
      return `列目录 ${truncate(str(args, 'path') || str(args, 'file_path')) || '.'}`;
    case 'edit':
    case 'str_replace_editor': {
      const path = truncate(str(args, 'path') || str(args, 'file_path'));
      const command = str(args, 'command');
      const verb =
        command === 'create'
          ? '创建'
          : command === 'insert'
            ? '插入'
            : command === 'view'
              ? '查看'
              : '编辑';
      return `${verb} ${path || '文件'}`;
    }
    case 'glob':
      return `搜索文件 ${truncate(str(args, 'pattern')) || '*'}`;
    case 'grep':
      return `搜索内容 ${truncate(str(args, 'pattern')) || ''}`.trimEnd();
    case 'todo':
      return '更新任务列表';
    case 'ask_user_question':
      return '向用户提问';
    case 'exit_plan_mode':
      return '提交计划';
    case 'subagent':
    case 'subagent_fork': {
      const description = str(args, 'description');
      return description.length > 0 ? `子代理 · ${truncate(description)}` : '启动子代理';
    }
    case 'send_message':
      return '子代理消息';
    case 'interrupt_agent':
      return '中止子代理';
    case 'list_agents':
      return '列出子代理';
    case 'skill':
      return `调用技能 ${truncate(str(args, 'name')) || toolName}`;
    default:
      return toolName;
  }
}
