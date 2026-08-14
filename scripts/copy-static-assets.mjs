import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 复制 tsc 不会处理的静态资源（HTML / CSS）到编译输出目录。
 * renderer 下新增静态目录时，在此登记一行即可。
 */
const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const src = path.join(root, 'src', 'renderer');
const dest = path.join(root, 'out', 'renderer');

await mkdir(dest, { recursive: true });
await cp(path.join(src, 'index.html'), path.join(dest, 'index.html'));
await cp(path.join(src, 'styles'), path.join(dest, 'styles'), { recursive: true });

console.log('Static assets copied to out/renderer');
