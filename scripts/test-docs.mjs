import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = resolve(root, 'docs');

function documentsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return documentsIn(path);
    return /\.(md|html)$/.test(entry.name) && entry.name !== 'local-login.md' ? [path] : [];
  });
}

test('docs 直接展示版本目录，各版索引均可查阅', () => {
  const entries = readdirSync(docs, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.'));
  for (const entry of entries) {
    assert(entry.isDirectory() && /^\d+\.\d+$/.test(entry.name), `意外的 docs 入口：${entry.name}`);
  }
  for (const version of ['1.1', '1.2', '1.3']) {
    assert(existsSync(resolve(docs, version, 'README.md')), `缺少 ${version} 版本索引`);
  }
});

test('项目 README 提供版本入口，旧版快照仍保留', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  for (const version of ['1.1', '1.2', '1.3']) {
    assert(readme.includes(`(docs/${version}/README.md)`), `项目 README 缺少 ${version} 入口`);
  }
  assert(existsSync(resolve(docs, '1.1/database-design-v1.1.html')));
  assert(existsSync(resolve(docs, '1.1/product-review.pdf')));
  assert(existsSync(resolve(docs, '1.2/changes.md')));
  assert(existsSync(resolve(docs, '1.2/module-test-cases.md')));
});

test('版本文档中的相对链接可以解析', () => {
  const broken = [];
  for (const file of [resolve(root, 'README.md'), resolve(root, 'agent.md'), ...documentsIn(docs)]) {
    const text = readFileSync(file, 'utf8');
    const pattern = basename(file).endsWith('.md')
      ? /\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g
      : /\b(?:href|src)="([^"]+)"/g;
    for (const [, url] of text.matchAll(pattern)) {
      if (/^(?:[a-z][a-z\d+.-]*:|[/#])/i.test(url)) continue;
      const target = decodeURIComponent(url.split('#', 1)[0]);
      if (target && !existsSync(resolve(dirname(file), target))) {
        broken.push(`${relative(root, file)} → ${url}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('本地登录说明被 Git 忽略', () => {
  const result = spawnSync('git', ['check-ignore', '-q', '--', 'docs/1.2/local-login.md'], { cwd: root });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, '登录说明可能未被忽略或已加入 Git');
});
