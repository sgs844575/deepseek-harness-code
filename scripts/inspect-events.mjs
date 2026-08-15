// 探查真实会话事件序列：回合内 chunk/tool/message 的交替顺序与 step 粒度。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.join(os.homedir(), '.deep-seek-harness-code', 'dsh-home', 'sessions');
const keys = fs.readdirSync(root);
let latest = null;
let lat = 0;
for (const k of keys) {
  const d = path.join(root, k);
  for (const s of fs.readdirSync(d)) {
    const f = path.join(d, s, 'session.jsonl');
    if (fs.existsSync(f)) {
      const st = fs.statSync(f);
      if (st.mtimeMs > lat) {
        lat = st.mtimeMs;
        latest = f;
      }
    }
  }
}
console.log('FILE', latest);
const lines = fs.readFileSync(latest, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const e of lines) {
  const t = String(e.type ?? '?');
  const d = e.data ?? e;
  let extra = '';
  if (t === 'assistant/chunk') extra = `${d.chunk?.type ?? ''} ${(d.chunk?.text ?? '').slice(0, 14)}`;
  if (t === 'tool/call') extra = `${d.name} turn=${d.turn ?? ''} step=${d.step ?? ''}`;
  if (t === 'assistant/message') {
    const blocks = (d.message?.content ?? []).map((b) => b.type).join(',');
    extra = `blocks=[${blocks}] turn=${d.turn ?? ''} step=${d.step ?? ''}`;
  }
  if (t === 'turn/start' || t === 'turn/end') extra = `turn=${d.turn ?? ''}`;
  if (t === 'user/message') extra = 'user';
  console.log(t.padEnd(20), extra);
}
