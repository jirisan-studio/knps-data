import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { discoverEndpoint } from './discover-endpoint.mjs';

const sources = [
  { id: '3068387', name: '로드킬', variable: 'DATA_GO_KR_ROADKILL_KEY', version: '20231220' },
  { id: '15090610', name: '산사태', variable: 'DATA_GO_KR_LANDSLIDE_KEY', version: '20221231', knownPath: '/15090610/v1/uddi:4c81cdaa-9667-45fa-af60-d10f1744a5c2' },
  { id: '15136172', name: '건축물', variable: 'DATA_GO_KR_BUILDINGS_KEY', version: '20240911' },
  { id: '15107577', name: '탐방객', variable: 'DATA_GO_KR_VISITORS_KEY', version: '20260331' },
  { id: '15136457', name: '경관자원조사결과', variable: 'DATA_GO_KR_LANDSCAPE_KEY', version: '20240911' },
];
const report = { checkedAt: new Date().toISOString(), mode: 'one-row checks; not full collection', datasets: [] };
const variables = new Map();
let endpointSettings = {};
try { endpointSettings = JSON.parse(await readFile(new URL('./api-endpoints.json', import.meta.url), 'utf8')); } catch { /* Known published endpoint remains available. */ }
try {
  const content = await readFile(new URL('./.env.local', import.meta.url), 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(DATA_GO_KR_[A-Z_]+)\s*=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    variables.set(match[1], value);
  }
} catch { console.log('Cannot read the local key file. No key values printed.'); process.exit(1); }

async function request(url) {
  return fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'error' });
}

for (const source of sources) {
  const item = { sourceId: source.id, dataset: source.name, status: 'not_checked' };
  report.datasets.push(item);
  console.log(`Checking ${source.name}...`);
  try {
    const key = variables.get(source.variable) || variables.get('DATA_GO_KR_SERVICE_KEY');
    if (!key) { item.status = 'missing_key'; continue; }
    let path = source.knownPath;
    const configured = endpointSettings[source.id];
    if (configured) {
      if (configured.startsWith('https://')) {
        const configuredUrl = new URL(configured);
        if (configuredUrl.origin !== 'https://api.odcloud.kr' || configuredUrl.username || configuredUrl.password || configuredUrl.search || configuredUrl.hash) { item.status = 'invalid_endpoint_configuration'; continue; }
        path = configuredUrl.pathname.replace(/^\/api/, '');
      } else { path = configured; }
    }
    if (!path) {
      const discovery = await discoverEndpoint(source, request, [...variables.values()]);
      item.documentationStatus = discovery.status;
      if (!discovery.path) { Object.assign(item, discovery); continue; }
      path = discovery.path;
      item.documentationUrl = discovery.docsUrl;
      if (discovery.summary) item.specificationSummary = discovery.summary;
    }
    if (!new RegExp(`^/${source.id}/v1/uddi:[a-fA-F0-9-]+(?:_[0-9]+)?$`).test(path)) { item.status = 'invalid_endpoint'; continue; }
    const endpoint = new URL(`https://api.odcloud.kr/api${path}`);
    item.endpoint = endpoint.href; // Public URL without the credential or query string.
    endpoint.searchParams.set('page', '1');
    endpoint.searchParams.set('perPage', '1');
    endpoint.searchParams.set('returnType', 'JSON');
    endpoint.searchParams.set('serviceKey', key);
    const response = await request(endpoint);
    item.httpStatus = response.status;
    if (!response.ok) {
      item.status = response.status === 401 || response.status === 403 ? 'authentication_or_permission_rejected' : 'http_error';
      await response.body?.cancel();
      continue;
    }
    let payload;
    try { payload = await response.json(); } catch { item.status = 'invalid_json'; continue; }
    if (!Array.isArray(payload.data) || !Number.isInteger(payload.totalCount) || payload.totalCount < 0) { item.status = 'unexpected_response'; continue; }
    item.status = 'success';
    item.totalCount = payload.totalCount;
    item.sampleRowCount = payload.data.length;
    // Preserve the first actual row locally for subsequent schema validation.
    // Refuse to save any payload containing a configured secret value.
    const sample = JSON.stringify({ sourceId: source.id, endpoint: item.endpoint, fetchedAt: new Date().toISOString(), totalCount: payload.totalCount, data: payload.data }, null, 2);
    if ([...variables.values()].filter(value => value.length >= 8).some(value => sample.includes(value))) { item.status = 'sample_contains_secret'; continue; }
    await mkdir(new URL('./work/', import.meta.url), { recursive: true });
    await writeFile(new URL(`./work/sample-${source.id}.json`, import.meta.url), sample + '\n', 'utf8');
  } catch { item.status = 'network_or_local_error'; }
}
try {
  await writeFile(new URL('./api-check-all-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('Results saved: api-check-all-result.json. No API keys printed.');
} catch { console.log('Could not save the result file.'); process.exitCode = 1; }
if (report.datasets.some(item => item.status !== 'success')) process.exitCode = 1;
