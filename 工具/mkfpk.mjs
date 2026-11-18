import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = process.argv[2];
const OUT = process.argv[3];

function octal(n, len) {
  const s = n.toString(8);
  return '0'.repeat(Math.max(0, len - 1 - s.length)) + s + '\0';
}

function header(name, size, mode, type) {
  const b = Buffer.alloc(512, 0);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const idx = name.lastIndexOf('/', name.length - 2);
    prefix = name.slice(0, idx);
    name = name.slice(idx + 1);
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) throw new Error('path too long: ' + prefix + '/' + name);
  }
  b.write(name, 0, 100, 'utf8');
  b.write(octal(mode, 8), 100, 8, 'ascii');
  b.write(octal(0, 8), 108, 8, 'ascii');
  b.write(octal(0, 8), 116, 8, 'ascii');
  b.write(octal(size, 12), 124, 12, 'ascii');
  b.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, 'ascii');
  b.write('        ', 148, 8, 'ascii');
  b.write(type, 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  b.write('root', 265, 32, 'ascii');
  b.write('root', 297, 32, 'ascii');
  b.write(prefix, 345, 155, 'utf8');

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += b[i];
  b.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return b;
}

function collect(dir, base, list) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      list.push({ rel: rel + '/', dir: true, full });
      collect(full, rel, list);
    } else {
      list.push({ rel: rel, dir: false, full });
    }
  }
}

function buildTar(entries, modeFn) {
  const chunks = [];
  for (const en of entries) {
    const mode = modeFn(en);
    if (en.dir) {
      chunks.push(header(en.rel, 0, mode, '5'));
    } else {
      const data = fs.readFileSync(en.full);
      chunks.push(header(en.rel, data.length, mode, '0'));
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) chunks.push(Buffer.alloc(pad, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

// 1) app.tgz：整棵 server 树，普通文件 0644，目录 0755（node_modules/.bin 里的脚本给 0755）
const appDir = path.join(SRC, 'app');
const appEntries = [];
collect(appDir, '', appEntries);
const appMode = (en) => {
  if (en.dir) return 0o755;
  if (en.rel.indexOf('node_modules/.bin/') === 0) return 0o755;
  return 0o644;
};
const appTar = buildTar(appEntries, appMode);
const appGz = zlib.gzipSync(appTar, { level: 9 });

// 2) 外层 fpk
const outer = [];
for (const name of ['manifest', 'ICON.PNG', 'ICON_256.PNG']) {
  outer.push({ rel: name, dir: false, full: path.join(SRC, name) });
}
for (const d of ['config', 'cmd', 'wizard']) {
  const full = path.join(SRC, d);
  if (!fs.existsSync(full)) continue;
  outer.push({ rel: d + '/', dir: true, full });
  collect(full, d, outer);
}
const outerMode = (en) => {
  if (en.dir) return 0o755;
  if (en.rel.indexOf('cmd/') === 0 || en.rel.indexOf('wizard/') === 0) return 0o755;
  return 0o644;
};
const outerTar = buildTar(outer, outerMode);

// 3) 追加 app.tgz
const atHeader = header('app.tgz', appGz.length, 0o644, '0');
const pad = (512 - (appGz.length % 512)) % 512;
const finalBuf = Buffer.concat([outerTar.subarray(0, outerTar.length - 1024), atHeader, appGz, Buffer.alloc(pad, 0), Buffer.alloc(1024, 0)]);
const gz = zlib.gzipSync(finalBuf, { level: 9 });
fs.writeFileSync(OUT, gz);
console.log('written ' + OUT + ' raw=' + finalBuf.length + ' gz=' + gz.length);
