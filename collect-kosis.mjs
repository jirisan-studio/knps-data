import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';

// Official guide: https://kosis.kr/openapi/devGuide/devGuide_0201List.do
// Official manual supports all for complete item/classification selection.
// 2009 onward uses persons; earlier years use thousands according to table notes.
const tableId = 'TX_35501_A042';
const orgId = '355';
const startYear = 2009;
const endYear = 2025; // Latest year verified in the official table, 2026-10-05.
const directory = new URL('./work/raw/', import.meta.url);
const report = { checkedAt: new Date().toISOString(), tableId, period: `${startYear}~${endYear}`, status: 'pending' };
const variables = new Map();
let inspectionFetchedAt;
await mkdir(directory, { recursive: true });
try {
  const env = (await readFile(new URL('./.env.local', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    variables.set(m[1], value);
  }
  const key = variables.get('KOSIS_API_KEY');
  if (!key || key.length < 8) throw new Error('missing_kosis_key');
  const url = new URL('https://kosis.kr/openapi/Param/statisticsParameterData.do');
  const parameters = { method: 'getList', apiKey: key, orgId, tblId: tableId, itmId: 'all', objL1: 'all', prdSe: 'Y', startPrdDe: String(startYear), endPrdDe: String(endYear), format: 'json', jsonVD: 'Y', smblChk: 'Y' };
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  console.log('Collecting KOSIS official annual park statistics (2009~2025)...');
  let rows;
  if (process.argv.includes('--from-inspection')) {
    const inspection = JSON.parse(await readFile(new URL('kosis-response-inspection.json', directory), 'utf8'));
    if (inspection.tableId !== tableId || !Number.isFinite(Date.parse(inspection.fetchedAt))) throw new Error('unexpected_record_schema');
    rows = inspection.data;
    inspectionFetchedAt = inspection.fetchedAt;
    report.mode = 'validate_saved_official_response';
  } else {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('network_connection_failed'); }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  report.httpStatus = response.status;
  if (!response.ok) { await response.body?.cancel(); throw new Error('http_error'); }
  try { rows = await response.json(); } catch { throw new Error('invalid_json'); }
  }
  if (!Array.isArray(rows)) {
    if (/^\d{1,4}$/.test(String(rows?.err ?? ''))) report.apiErrorCode = String(rows.err);
    throw new Error('api_error_response');
  }
  if (!rows.length) throw new Error('empty_response');
  // Preserve the response for local inspection even if its schema differs.
  // Never log raw rows, credential-bearing URLs, or the server's error text.
  const diagnostic = JSON.stringify({ fetchedAt: inspectionFetchedAt ?? new Date().toISOString(), tableId, data: rows }, null, 2);
  const diagnosticSecrets = [...variables.values()].filter(value => value.length >= 8);
  if (diagnosticSecrets.some(value => diagnostic.includes(value) || diagnostic.includes(encodeURIComponent(value)))) throw new Error('secret_detected_in_response');
  await writeFile(new URL('kosis-response-inspection.json', directory), diagnostic, 'utf8');
  report.rowsReceived = rows.length;
  const seen = new Set();
  for (const row of rows) {
    const checks = {
      object: !!row && typeof row === 'object' && !Array.isArray(row),
      organization: String(row?.ORG_ID) === orgId,
      table: row?.TBL_ID === tableId,
      annualPeriod: ['A', 'Y'].includes(row?.PRD_SE),
      year: /^\d{4}$/.test(String(row?.PRD_DE)) && Number(row.PRD_DE) >= startYear && Number(row.PRD_DE) <= endYear,
      parkLabel: !!row?.C1_NM,
      itemCode: !!row?.ITM_ID,
      valuePresent: row?.DT !== undefined
    };
    if (Object.values(checks).some(valid => !valid)) {
      report.schemaMismatch = { failedChecks: Object.keys(checks).filter(name => !checks[name]), returnedFields: Object.keys(row ?? {}).filter(name => /^[A-Z][A-Z0-9_]*$/.test(name)) };
      throw new Error('unexpected_record_schema');
    }
    const id = JSON.stringify([row.PRD_DE, row.ITM_ID, ...Array.from({length:8}, (_, i) => row[`C${i + 1}`] ?? null)]);
    if (seen.has(id)) throw new Error('duplicate_statistical_cell');
    seen.add(id);
  }
  const years = [...new Set(rows.map(row => Number(row.PRD_DE)))].sort((a,b) => a-b);
  if (years.length !== endYear - startYear + 1) throw new Error('incomplete_year_coverage');
  const fetchedAt = inspectionFetchedAt ?? new Date().toISOString();
  const snapshot = JSON.stringify({ sourceId: `kosis-${tableId}`, name: '공원별 연간 탐방객 수', provider: '국립공원공단', distributor: 'KOSIS', sourceUrl: `https://kosis.kr/statHtml/statHtml.do?orgId=${orgId}&tblId=${tableId}&conn_path=I2`, endpoint: url.origin + url.pathname, fetchedAt, period: {startYear, endYear}, totalCount: rows.length, data: rows }, null, 2);
  const secrets = [...variables.values()].filter(value => value.length >= 8);
  if (secrets.some(value => snapshot.includes(value) || snapshot.includes(encodeURIComponent(value)))) throw new Error('secret_detected_in_response');
  const temporary = new URL(`kosis-annual-visitors.${process.pid}.tmp`, directory);
  await writeFile(temporary, snapshot, 'utf8');
  await rename(temporary, new URL('kosis-annual-visitors.json', directory));
  Object.assign(report, { status: 'success', rowsReceived: rows.length, years, parkLabels: [...new Set(rows.map(row => row.C1_NM))], items: [...new Set(rows.map(row => row.ITM_NM))], units: [...new Set(rows.map(row => row.UNIT_NM))], fetchedAt });
} catch (error) {
  const known = new Set(['missing_kosis_key','network_connection_failed','http_error','invalid_json','api_error_response','empty_response','unexpected_record_schema','duplicate_statistical_cell','incomplete_year_coverage','secret_detected_in_response']);
  report.status = known.has(error?.message) ? error.message : 'local_configuration_or_save_error';
  process.exitCode = 1;
}
await writeFile(new URL('./work/kosis-collection-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
console.log('Result saved under work/. API key and request URL were not printed or saved. Existing snapshots are preserved on failure.');
