import {parkId} from './lib.mjs';
export function normalizeAnnualVisitors(source) {
  if (source.sourceId !== 'kosis-TX_35501_A042' || !Array.isArray(source.data) || source.totalCount !== source.data.length) throw Error('Invalid KOSIS snapshot');
  const fields = [...new Set(source.data.flatMap(Object.keys))], seen = new Set();
  const rows = source.data.map((r,i) => {
    const y = Number(r.PRD_DE), text = String(r.DT).trim();
    if (r.ORG_ID !== '355' || r.TBL_ID !== 'TX_35501_A042' || !['A','Y'].includes(r.PRD_SE) || !Number.isInteger(y) || y < 2009 || y >= new Date().getUTCFullYear() || r.UNIT_NM !== '명' || r.ITM_NM !== '탐방객 현황') throw Error('Unexpected annual visitor unit, item or period');
    const v = /^\d+$/.test(text) ? Number(text) : null;
    if (v !== null && !Number.isSafeInteger(v)) throw Error('Invalid annual visitor count');
    const kind = r.C1_NM === '총계' ? 'total' : r.C1_NM === '오동도' ? 'subset' : 'park';
    const p = kind === 'park' ? parkId(r.C1_NM) : null;
    if (kind === 'park' && !p) throw Error('Unmapped KOSIS park');
    const cell = `${y}|${r.C1}|${r.ITM_ID}`;
    if (seen.has(cell)) throw Error('Duplicate annual visitor cell'); seen.add(cell);
    return {i:i+1,p,d:null,y,l:r.C1_NM,v,lat:null,lon:null,kind,raw:fields.map(f=>r[f]??null)};
  });
  const years = [...new Set(rows.map(r=>r.y))].sort((a,b)=>a-b);
  for (const y of years) if (rows.filter(r=>r.y===y && r.kind==='total' && r.v!==null).length !== 1) throw Error('Missing annual official total');
  const updated = source.data.map(r=>r.LST_CHN_DE).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1);
  return {meta:{id:'kosis-TX_35501_A042',key:'annual-visitors',name:'공원별 연간 탐방객',category:'탐방',version:`${years.at(-1)}년 연간 통계`,modified:updated??'미확인',note:'KOSIS 국립공원기본통계의 공원별 연간 탐방객 수입니다. 전국은 공식 총계를 사용합니다. 한려해상은 오동도를 포함하므로 오동도를 추가 합산하지 않습니다. 팔공산은 2025년부터 집계됩니다. 원본에 없는 공원·연도 자료는 생성하지 않습니다. 고유 방문자 수가 아닙니다.',parkable:true,map:false,unit:'명',provider:'국립공원공단 · KOSIS',sourceUrl:source.sourceUrl,endpoint:source.endpoint,fetchedAt:source.fetchedAt,refreshMethod:'KOSIS 공식 API; 주간 수집 작업 (마지막 성공일은 수집일 확인)',count:rows.length,fields,dates:null,periodLabel:`${years[0]} ~ ${years.at(-1)} (연간)`,years,mapped:rows.filter(r=>r.p).length,coordinateValid:0,duplicateRows:0,missingValues:rows.filter(r=>r.v===null).length},rows};
}
