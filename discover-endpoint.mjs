import { mkdir, writeFile } from 'node:fs/promises';

export function documentedPaths(text, sourceId) {
  const pattern = new RegExp(`/${sourceId}/v1/uddi:[a-fA-F0-9-]+(?:_[0-9]+)?`, 'g');
  return [...new Set(text.replace(/\\\//g, '/').match(pattern) || [])];
}

function declaredSpecUrls(text, base) {
  const urls = [];
  const patterns = [/(?:\burl|\bspecUrl|\bspec_url)\s*:\s*(['"])([^'"]+)\1/g, /(?:\burl|\bspecUrl|\bspec_url)\s*=\s*(['"])([^'"]+)\1/g, /spec-url\s*=\s*(['"])([^'"]+)\1/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      // Only fully literal URLs declared by the public document; no JS execution.
      if (/[{}<>]/.test(match[2])) continue;
      try {
        const candidate = new URL(match[2].replace(/&amp;/g, '&'), base);
        if (candidate.origin === 'https://infuser.odcloud.kr' && !candidate.username && !candidate.password) urls.push(candidate.href);
      } catch { /* Ignore non-URL values. */ }
    }
  }
  return [...new Set(urls)];
}

export async function discoverEndpoint(source, request, secretValues = []) {
  const docsUrl = `https://infuser.odcloud.kr/oas/docs?namespace=${source.id}/v1`;
  const response = await request(docsUrl);
  if (!response.ok) { await response.body?.cancel(); return { status: 'documentation_unavailable', docsHttpStatus: response.status }; }
  const html = await response.text();
  const directory = new URL('./work/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const safeWrite = async (filename, contents) => {
    if (secretValues.filter(value => value.length >= 8).some(value => contents.includes(value))) throw new Error('Refusing secret-bearing document');
    await writeFile(new URL(filename, directory), contents, 'utf8');
  };
  await safeWrite(`swagger-docs-${source.id}.html`, html);
  try {
    const document = JSON.parse(html);
    if ((document.swagger || document.openapi) && document.paths) {
      const candidates = Object.entries(document.paths)
        .filter(([path, methods]) => methods.get && documentedPaths(path, source.id).includes(path))
        .map(([path, methods]) => ({ path, summary: String(methods.get.summary || '') }));
      const matching = candidates.filter(candidate => candidate.summary.endsWith(source.version));
      const selected = matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : null;
      if (selected) return { ...selected, docsUrl, status: 'discovered' };
      return { status: 'endpoint_selection_required', docsUrl, candidates };
    }
  } catch { /* HTML Swagger pages use the extraction below. */ }
  let paths = documentedPaths(html, source.id);
  if (paths.length === 1) return { path: paths[0], docsUrl, status: 'discovered' };
  const documents = [{ text: html, base: docsUrl }];
  // Some pages keep their Swagger configuration in a separate local script.
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi)]
    .map(match => new URL(match[2].replace(/&amp;/g, '&'), docsUrl))
    .filter(url => url.origin === 'https://infuser.odcloud.kr' && !/jquery|swagger-ui|bootstrap|polyfill|moment|highlight/i.test(url.pathname))
    .slice(0, 6);
  for (let index = 0; index < scripts.length; index++) {
    const scriptResponse = await request(scripts[index]);
    if (!scriptResponse.ok) { await scriptResponse.body?.cancel(); continue; }
    const scriptText = await scriptResponse.text();
    await safeWrite(`swagger-script-${source.id}-${index}.js`, scriptText);
    documents.push({ text: scriptText, base: scripts[index].href });
  }
  const specUrls = [...new Set(documents.flatMap(document => declaredSpecUrls(document.text, document.base)))].slice(0, 8);
  const candidates = [];
  for (let index = 0; index < specUrls.length; index++) {
    const specResponse = await request(specUrls[index]);
    if (!specResponse.ok) { await specResponse.body?.cancel(); continue; }
    const specText = await specResponse.text();
    let spec;
    try { spec = JSON.parse(specText); } catch { continue; }
    if (!(spec.openapi || spec.swagger) || !spec.paths) continue;
    await safeWrite(`swagger-spec-${source.id}-${index}.json`, specText);
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (methods.get && documentedPaths(path, source.id).includes(path)) candidates.push({ path, summary: String(methods.get.summary || '').slice(0, 250), specUrl: specUrls[index] });
    }
  }
  const unique = [...new Map(candidates.map(candidate => [candidate.path, candidate])).values()];
  const expected = unique.filter(candidate => candidate.summary.includes(source.version));
  const selected = expected.length === 1 ? expected[0] : unique.length === 1 ? unique[0] : null;
  if (selected) return { ...selected, docsUrl, status: 'discovered' };
  return { status: 'documentation_saved_for_inspection', docsUrl, candidates: unique };
}
