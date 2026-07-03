import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';

const root = resolve('.');
const source = resolve(root, 'dist');
const target = resolve(root, 'docs');

if (!existsSync(source)) {
  throw new Error('dist directory does not exist. Run npm run build first.');
}

if (!target.startsWith(`${root}${sep}`)) {
  throw new Error(`Refusing to write outside the project: ${target}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

const indexPath = resolve(target, 'index.html');
const builtAppPath = resolve(target, 'app.html');
if (existsSync(builtAppPath)) {
  renameSync(builtAppPath, indexPath);
}

const html = readFileSync(indexPath, 'utf8').replaceAll('/delivery-system/assets/', '/delivery-system/docs/assets/');
writeFileSync(indexPath, html);
writeFileSync(resolve(target, '.nojekyll'), '');
copyFileSync(indexPath, resolve(root, 'index.html'));

console.log(`Synced ${source} to ${target}`);
