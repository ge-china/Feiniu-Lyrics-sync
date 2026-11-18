import timers from 'node:timers/promises';

export const sleep = (ms) => timers.setTimeout(ms);

// 归一化：全角转半角、去括号内容、去 feat/live 等噪声、只留字母数字和中文
export function norm(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\(\（\[\【].*?[\)\）\]\】]/g, ' ')
    .replace(/\b(feat|ft|featuring|remaster|remastered|live|version|remix)\b/g, ' ')
    .replace(/伴奏|纯音乐|高音质|无损/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export async function httpJson(url, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 20000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: o.method || 'GET',
      headers: Object.assign({
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*'
      }, o.headers || {}),
      body: o.body,
      signal: ac.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, ok: res.ok, text: text, json: json };
  } finally {
    clearTimeout(timer);
  }
}

export function looksLikeLrc(text) {
  return /\[\d{1,2}:\d{1,2}(\.\d{1,3})?\]/.test(String(text || ''));
}

export function fmtDur(sec) {
  if (!sec) return '?:??';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}
