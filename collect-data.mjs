import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';

const sources = [
  { id: '3068387', name: '로드킬', keyName: 'DATA_GO_KR_ROADKILL_KEY', version: '20231220' },
  { id: '15090610', name: '산사태', keyName: 'DATA_GO_KR_LANDSLIDE_KEY', version: '20221231' },
  { id: '15136172', name: '건축물', keyName: 'DATA_GO_KR_BUILDINGS_KEY', version: '20240911' },
  { id: '15107577', name: '탐방객', keyName: 'DATA_GO_KR_VISITORS_KEY', version: '20260331' },
  { id: '15136457', name: '경관자원조사결과', keyName: 'DATA_GO_KR_LANDSCAPE_KEY', version: '20240911' },
];
const report = { startedAt: new Date().toISOString(), mode: 'full paginated collection', datasets: [] };
const variables = new Map();
let endpoints;
try {
  endpoints = JSON.parse((await readFile(new URL('./api-endpoints.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
  const contents = await readFile(new URL('./.env.local', import.meta.url), 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(DATA_GO_KR_[A-Z_]+)\s*=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    variables.set(match[1], value);
  }
} catch { console.log('Cannot read local configuration. No secret values printed.'); process.exit(1); }

const rawDirectory = new URL('./work/raw/', import.meta.url);
await mkdir(rawDirectory, { recursive: true });
const secrets = [...variables.values()].filter(value => value.length >= 8);

for (const source of sources) {
  const result = { sourceId: source.id, dataset: source.name, status: 'pending', sourceVersion: source.version };
  report.datasets.push(result);
  console.log(`Collecting ${source.name}...`);
  try {
    const key = variables.get(source.keyName) || variables.get('DATA_GO_KR_SERVICE_KEY');
    if (!key) { result.status = 'missing_key'; continue; }
    const base = new URL(endpoints[source.id]);
    if (base.origin !== 'https://api.odcloud.kr' || base.username || base.password || base.search || base.hash || !new RegExp(`^/api/${source.id}/v1/uddi:[a-fA-F0-9-]+(?:_[0-9]+)?$`).test(base.pathname)) { result.status = 'invalid_endpoint'; continue; }
    result.endpoint = base.href;
    let total = null;
    const rows = [];
    let page = 1;
    const pageSize = 1000;
    let complete = false;
    while (page <= 1000) {
      const url = new URL(base);
      url.searchParams.set('page', String(page));
      url.searchParams.set('perPage', String(pageSize));
      url.searchParams.set('returnType', 'JSON');
      url.searchParams.set('serviceKey', key);
      let response;
      // Retry only temporary HTTP failures; do not retry authentication errors.
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      }
      result.lastHttpStatus = response.status;
      if (!response.ok) {
        result.status = [401, 403].includes(response.status) ? 'authentication_or_permission_rejected' : 'http_error';
        await response.body?.cancel();
        break;
      }
      let payload;
      try { payload = await response.json(); } catch { result.status = 'invalid_json'; break; }
      if (!Array.isArray(payload.data) || !Number.isInteger(payload.totalCount) || payload.totalCount < 0 || payload.page !== page || payload.perPage !== pageSize || payload.currentCount !== payload.data.length) { result.status = 'invalid_pagination_response'; break; }
      if (total === null) total = payload.totalCount;
      if (payload.totalCount !== total) { result.status = 'source_changed_during_collection'; break; }
      if (payload.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) { result.status = 'invalid_record'; break; }
      rows.push(...payload.data);
      result.pagesReceived = page;
      result.rowsReceived = rows.length;
      result.totalCount = total;
      if (rows.length > total) { result.status = 'row_count_exceeds_total'; break; }
      if (rows.length === total) { complete = true; break; }
      if (payload.data.length !== pageSize) { result.status = 'incomplete_page'; break; }
      page++;
      if (page % 10 === 0) console.log(`${source.name}: ${rows.length} / ${total} rows`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!complete) { if (result.status === 'pending') result.status = 'page_limit_exceeded'; continue; }
    const fetchedAt = new Date().toISOString();
    const snapshot = JSON.stringify({ sourceId: source.id, name: source.name, provider: '국립공원공단', sourceUrl: `https://www.data.go.kr/data/${source.id}/fileData.do`, endpoint: base.href, sourceVersion: source.version, fetchedAt, totalCount: total, data: rows }, null, 2);
    if (secrets.some(secret => snapshot.includes(secret) || snapshot.includes(encodeURIComponent(secret)))) { result.status = 'secret_detected_in_response'; continue; }
    const temporary = new URL(`source-${source.id}.${process.pid}.tmp`, rawDirectory);
    await writeFile(temporary, snapshot + '\n', 'utf8');
    await rename(temporary, new URL(`source-${source.id}.json`, rawDirectory));
    result.status = 'success';
    result.fetchedAt = fetchedAt;
    result.fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
    console.log(`${source.name}: success, ${total} rows saved`);
  } catch { result.status = 'network_or_local_error'; }
}
report.finishedAt = new Date().toISOString();
try {
  await writeFile(new URL('./collection-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('Saved collection-result.json. API keys were not printed or saved in snapshots.');
} catch { console.log('Could not save the collection report.'); process.exitCode = 1; }
if (report.datasets.some(result => result.status !== 'success')) process.exitCode = 1;
