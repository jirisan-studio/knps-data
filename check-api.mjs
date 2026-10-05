import { readFile, writeFile } from 'node:fs/promises';

// Known endpoint published in the official dataset specification:
// https://www.data.go.kr/data/15090610/fileData.do
const resultPath = new URL('./api-check-result.json', import.meta.url);
const report = { checkedAt: new Date().toISOString(), dataset: '산사태 현황', sourceId: '15090610', mode: 'one-row connectivity check', status: 'not_checked' };
try {
  const contents = await readFile(new URL('./.env.local', import.meta.url), 'utf8');
  const variables = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(DATA_GO_KR_[A-Z_]+)\s*=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    variables.set(match[1], value);
  }
  const key = variables.get('DATA_GO_KR_LANDSLIDE_KEY') || variables.get('DATA_GO_KR_SERVICE_KEY');
  if (!key) {
    report.status = 'missing_key';
  } else {
    const endpoint = new URL('https://api.odcloud.kr/api/15090610/v1/uddi:4c81cdaa-9667-45fa-af60-d10f1744a5c2');
    endpoint.searchParams.set('page', '1');
    endpoint.searchParams.set('perPage', '1');
    endpoint.searchParams.set('returnType', 'JSON');
    endpoint.searchParams.set('serviceKey', key);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    report.httpStatus = response.status;
    if (!response.ok) {
      report.status = response.status === 401 || response.status === 403 ? 'authentication_or_permission_rejected' : 'http_error';
      // Do not print an upstream body: it can contain request URLs or credentials.
      await response.body?.cancel();
    } else {
      let payload;
      try { payload = await response.json(); } catch { report.status = 'invalid_json'; }
      if (payload) {
        if (Array.isArray(payload.data) && Number.isInteger(payload.totalCount) && payload.totalCount >= 0) {
          report.status = 'success';
          report.totalCount = payload.totalCount;
          report.sampleRowCount = payload.data.length;
        } else {
          report.status = 'unexpected_response';
        }
      }
    }
  }
} catch {
  // Never expose exception messages or stacks containing a credential-bearing URL.
  report.status = 'local_file_or_network_error';
}
try {
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('Result saved: api-check-result.json (no API key or record values).');
} catch {
  console.log('Could not save the result file.');
  process.exitCode = 1;
}
if (report.status !== 'success') process.exitCode = 1;
