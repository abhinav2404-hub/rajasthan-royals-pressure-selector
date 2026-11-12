import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const template = await readFile(resolve(root, 'dashboard.template.html'), 'utf8');
const rankings = await readFile(resolve(root, 'data', 'rankings.json'), 'utf8');
const summary = await readFile(resolve(root, 'data', 'summary.json'), 'utf8');
const page = template
  .replace('__DATA__', JSON.stringify(JSON.parse(rankings)))
  .replace('__SUMMARY__', JSON.stringify(JSON.parse(summary)));

await Promise.all([
  writeFile(resolve(root, 'index.html'), page, 'utf8'),
  writeFile(resolve(root, 'pressure_performance_dashboard.html'), page, 'utf8'),
]);
console.log(`Built dashboard pages in ${root}`);
