import fs from 'node:fs';
import path from 'node:path';

export const APP_NAME = 'musictb';
export const APP_TITLE = '飞牛歌词同步';

export const dataDir = process.env.MUSICTB_DATA || process.env.TRIM_PKGVAR || path.join(process.cwd(), 'data');
export const backupDir = path.join(dataDir, 'backup');
export const userSourceDir = path.join(dataDir, 'sources');
export const libraryFile = path.join(dataDir, 'library.json');
export const configFile = path.join(dataDir, 'config.json');

export const DEFAULTS = {
  libraryRoot: '',
  writeMode: 'lrc',
  downloadMode: 'ask',
  sources: { lrclib: true, netease: true, qq: true, kugou: true, kuwo: false },
  userSources: [],
  minScore: 55,
  lyricFetchTop: 3,
  skipInstrumental: true,
  sourceTimeoutMs: 15000,
  durationTolerance: 5,
  concurrency: 2,
  requestDelayMs: 250,
  autoEnabled: false,
  autoIntervalMinutes: 1440,
  backupBeforeEmbed: false,
  keepExisting: true,
  port: 8791
};

export function ensureDirs() {
  for (const d of [dataDir, backupDir, userSourceDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function loadConfig() {
  ensureDirs();
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (e) {}
  const cfg = Object.assign({}, DEFAULTS, raw);
  cfg.sources = Object.assign({}, DEFAULTS.sources, raw.sources || {});
  return cfg;
}

export function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
