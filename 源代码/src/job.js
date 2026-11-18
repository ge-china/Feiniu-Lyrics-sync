import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const LOGFILE = path.join(dataDir, 'job.log');

function appendFile(line) {
  try {
    const t = fs.statSync(LOGFILE);
    if (t.size > 1024 * 1024) fs.renameSync(LOGFILE, LOGFILE + '.old');
  } catch (e) {}
  try { fs.appendFileSync(LOGFILE, line + '\n', 'utf8'); } catch (e) {}
}

let current = { id: 0, kind: '', running: false, total: 0, done: 0, ok: 0, fail: 0, skipped: 0, current: '', startedAt: 0, finishedAt: 0, summary: '', messages: [] };
let stopFlag = false;

export function getJob() { return current; }

export function startJob(kind, total, summary) {
  current = {
    id: Date.now(),
    kind: kind,
    running: true,
    total: total || 0,
    done: 0, ok: 0, fail: 0, skipped: 0,
    current: '',
    startedAt: Date.now(),
    finishedAt: 0,
    summary: summary || '',
    messages: []
  };
  stopFlag = false;
  return current;
}

export function updateJob(patch) {
  Object.assign(current, patch);
  return current;
}

export function logLine(line) {
  current.current = line;
  appendFile(new Date().toISOString() + ' ' + line);
  current.messages.push({ t: Date.now(), line: line });
  if (current.messages.length > 400) current.messages.splice(0, current.messages.length - 400);
}

export function finishJob(summary) {
  current.running = false;
  current.finishedAt = Date.now();
  if (summary) current.summary = summary;
  current.current = '';
  return current;
}

export function requestStop() { stopFlag = true; return true; }
export function shouldStop() { return stopFlag; }
