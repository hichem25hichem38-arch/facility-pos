// 静态输出：把 web/ 的成品复制到 dist/，dist/ 才是上传目录。
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}web`, `${root}dist`, { recursive: true });
console.log('dist ready');
