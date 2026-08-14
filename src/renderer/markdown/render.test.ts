import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown（安全极简渲染）', () => {
  it('转义 HTML，杜绝注入', () => {
    const html = renderMarkdown('<script>alert(1)</script> & <b>bold</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('围栏代码块渲染为 pre/code', () => {
    const html = renderMarkdown('正文\n```ts\nconst a = 1;\n```\n结尾');
    expect(html).toContain('<pre><code>const a = 1;</code></pre>');
    expect(html).toContain('<p>正文</p>');
    expect(html).toContain('<p>结尾</p>');
  });

  it('代码块内的 HTML 同样被转义', () => {
    const html = renderMarkdown('```\n<img src=x>\n```');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('行内代码与加粗', () => {
    const html = renderMarkdown('使用 `read` 工具，**务必**先读后写');
    expect(html).toContain('<code>read</code>');
    expect(html).toContain('<strong>务必</strong>');
  });

  it('标题降级为 h3-h5，段落内换行转 <br />', () => {
    const html = renderMarkdown('# 大标题\n第一行\n第二行');
    expect(html).toContain('<h3>大标题</h3>');
    expect(html).toContain('第一行<br />第二行');
  });
});
