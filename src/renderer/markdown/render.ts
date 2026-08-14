/**
 * 极简安全 Markdown 渲染：先把输入整体 HTML 转义，再在转义后的文本上
 * 应用受控的少量标记（代码块 / 行内代码 / 加粗 / 标题 / 换行），
 * 输出的 HTML 只包含我们生成的标签——不存在注入面。
 *
 * 不追求完整 Markdown：对话场景覆盖代码块与强调即可，复杂排版交给二期。
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 行内标记：行内代码、加粗。在已转义文本上执行。 */
function inlineMarkup(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

/** 块级渲染：标题、段落、换行。在已转义文本上执行。 */
function blockMarkup(escaped: string): string {
  const lines = escaped.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.map(inlineMarkup).join('<br />')}</p>`);
      paragraph = [];
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level + 2}>${inlineMarkup(heading[2])}</h${level + 2}>`); // h3..h5，对话内标题降级
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join('');
}

export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const parts: string[] = [];
  // 按 ``` 围栏切分：偶数段是普通文本，奇数段是代码块内容。
  const segments = escaped.split(/```(?:[a-zA-Z0-9_+-]*\n)?/);
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i % 2 === 0) {
      parts.push(blockMarkup(segment));
    } else {
      const code = segment.endsWith('\n') ? segment.slice(0, -1) : segment;
      parts.push(`<pre><code>${code}</code></pre>`);
    }
  }
  return parts.join('');
}
