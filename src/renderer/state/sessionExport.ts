import type { SessionUiState } from './sessionStore';

/**
 * 会话 → Markdown 导出文本构建（纯函数）。
 * 结构与对话流一致：用户 / 助手（思考过程折叠）/ 工具卡 / 错误行。
 */

function fence(language: string, body: string): string {
  // 正文里的 ``` 会破坏围栏，抬高围栏长度规避。
  const ticks = '`'.repeat(Math.max(3, (body.match(/`{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0) + 1));
  return `${ticks}${language}\n${body}\n${ticks}`;
}

export function buildSessionMarkdown(state: SessionUiState, sessionId: string): string {
  const lines: string[] = [];
  lines.push(`# ${state.title.length > 0 ? state.title : sessionId}`);
  lines.push('');
  lines.push(`> 导出自 DeepSeek Harness Code · ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  for (const message of state.messages) {
    if (message.role === 'user') {
      lines.push('## 用户');
      lines.push('');
      lines.push(message.text);
      lines.push('');
      continue;
    }
    if (message.role === 'error') {
      lines.push(`> ⚠ ${message.text}`);
      lines.push('');
      continue;
    }
    lines.push('## 助手');
    lines.push('');
    if (message.reasoning.length > 0) {
      lines.push('<details><summary>思考过程</summary>');
      lines.push('');
      lines.push(fence('', message.reasoning));
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (message.text.length > 0) {
      lines.push(message.text);
      lines.push('');
    }
    for (const tool of message.tools) {
      const status = tool.status === 'running' ? '（运行中）' : tool.status === 'error' ? '（失败）' : '';
      lines.push(`**工具 \`${tool.name}\`${status}**`);
      lines.push('');
      if (tool.argumentsText.length > 0) {
        lines.push(fence('jsonc', tool.argumentsText));
        lines.push('');
      }
      if (tool.resultText.length > 0) {
        lines.push(fence('', tool.resultText));
        lines.push('');
      }
    }
    if (message.usageText.length > 0) {
      lines.push(`<sub>${message.usageText}</sub>`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** 导出文件名：优先会话标题，清洗 Windows 非法字符。 */
export function exportFileName(state: SessionUiState, sessionId: string): string {
  const base = (state.title.length > 0 ? state.title : sessionId).replace(/[\\/:*?"<>|]/g, '_');
  return `${base.slice(0, 80)}.md`;
}
