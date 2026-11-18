import http from 'node:http';

const SOCK = '/var/run/trim_open_gateway_apiscope.socket';

function callTrim(req, appName, data) {
  return new Promise(function (resolve, reject) {
    const token = process.env.TRIM_API_TOKEN || '';
    if (!token) return reject(new Error('TRIM_API_TOKEN 不可用（非 fnOS 环境）'));
    const body = JSON.stringify({ reqId: String(Date.now()), req: req, appName: appName, data: data || {} });
    const r = http.request({
      socketPath: SOCK,
      path: '/api/v1/trimapp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: 'Bearer ' + token
      },
      timeout: 8000
    }, function (res) {
      let d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('响应解析失败')); }
      });
    });
    r.on('error', reject);
    r.on('timeout', function () { r.destroy(new Error('超时')); });
    r.write(body);
    r.end();
  });
}

export function isFnos() {
  return !!process.env.TRIM_API_TOKEN;
}

export async function getSharedFolders(appName) {
  if (!isFnos()) return { ok: false, error: 'not-fnos', paths: [] };
  try {
    const r = await callTrim('trim.file.getSharedAccessibleFolders', appName, {});
    const paths = (r && r.data && r.data.paths) ? r.data.paths : [];
    return { ok: r.code === 0, paths: paths, raw: r };
  } catch (e) {
    return { ok: false, error: e.message, paths: [] };
  }
}

export async function getPlatformConfig(appName) {
  if (!isFnos()) return null;
  try {
    const r = await callTrim('trim.system.getPlatformConfig', appName, {});
    return r && r.data ? r.data : null;
  } catch (e) {
    return null;
  }
}
