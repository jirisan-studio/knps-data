import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parks,parkId,validDate,validYear,coordinatePair} from './lib.mjs';
const configuration=[
 {id:'3068387',key:'roadkill',name:'로드킬',category:'자연자원',version:'2023-12-20',modified:'2025-06-13',note:'공개된 조사기록 수입니다. 실제 사고 총수·위험도가 아닙니다. 동일 내용의 행도 근거 없이 삭제하지 않았습니다.',parkable:true,map:true,unit:'기록'},
 {id:'15090610',key:'landslide',name:'산사태',category:'재난·안전',version:'2022-12-31',modified:'2025-06-13',note:'2015~2022년 공개 발생기록입니다. 실시간 재난 위험·탐방 통제정보가 아닙니다.',parkable:true,map:true,unit:'기록'},
 {id:'15136172',key:'buildings',name:'건축물',category:'시설',version:'2024-09-11',modified:'2025-08-06',note:'공원 귀속과 X·Y 좌표계가 확인되지 않아 전국 원본 목록만 제공합니다. 기록 수는 고유 건축물 수가 아닙니다.',parkable:false,map:false,unit:'기록'},
 {id:'15107577',key:'visitors',name:'탐방객',category:'탐방',version:'2026-03-31',modified:'2026-05-21',note:'설악산의 선택한 탐방지역별 계수 기록입니다. 여러 지점의 값을 합산하지 않으며 고유 방문자 수로 해석하지 않습니다.',parkable:true,map:false,unit:'명'},
 {id:'15136457',key:'landscape',name:'경관자원',category:'경관·지질',version:'2024-09-11',modified:'2025-06-12',note:'공원명·조사일 필드가 없어 전국 위치와 목록을 제공합니다. 주소로 공원 귀속을 추정하지 않았습니다.',parkable:false,map:true,unit:'기록'}
];
const directory=new URL('./site/data/',import.meta.url);await mkdir(directory,{recursive:true});
let secretValues=[];try{const env=await readFile(new URL('./.env.local',import.meta.url),'utf8');secretValues=env.split(/\r?\n/).filter(l=>/^DATA_GO_KR_/.test(l)).map(l=>l.slice(l.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'')).filter(v=>v.length>=8);}catch{/*Build does not require secrets.*/}
const manifest={generatedAt:new Date().toISOString(),parks,parkSource:'https://www.knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=7020102&parkId=122800',parkCheckedAt:'2026-10-05',datasets:[]};
for(const config of configuration){
 const rawText=await readFile(new URL(`./work/raw/source-${config.id}.json`,import.meta.url),'utf8');
 const source=JSON.parse(rawText);if(source.sourceId!==config.id||source.data.length!==source.totalCount)throw new Error('Source completeness check failed: '+config.id);
 const fields=[...new Set(source.data.flatMap(Object.keys))];const exact=new Set();let duplicates=0;
 const rows=source.data.map((r,i)=>{const fingerprint=JSON.stringify(r);if(exact.has(fingerprint))duplicates++;exact.add(fingerprint);let p=null,d=null,y=null,l='',v=null,lat=null,lon=null;
  if(config.key==='roadkill'){p=parkId(r['국립공원명']);d=validDate(r['조사일자']);y=d?Number(d.slice(0,4)):null;l=r['자원명']??'';[lat,lon]=coordinatePair(r['위도'],r['경도']);}
  if(config.key==='landslide'){p=parkId(r['공원명']);y=validYear(r['발생시기']);l=r['구간명']??'';[lat,lon]=coordinatePair(r['위도'],r['경도']);}
  if(config.key==='buildings'){y=validYear(r['시공연도']);l=r['시설물명칭']??'';}
  if(config.key==='visitors'){p=parkId(r['국립공원']);d=validDate(r['일자']);y=d?Number(d.slice(0,4)):null;l=r['탐방지역']??'';v=Number.isInteger(r['전체 탐방객수'])&&r['전체 탐방객수']>=0?r['전체 탐방객수']:null;}
  if(config.key==='landscape'){l=r['경관위치명']??'';[lat,lon]=coordinatePair(r['경관위치_위도'],r['경관위치_경도']);}
  return {i:i+1,p,d,y,l,v,lat,lon,raw:fields.map(f=>r[f]??null)};
 });
 const dates=rows.map(r=>r.d).filter(Boolean).sort();const years=rows.map(r=>r.y).filter(v=>v!==null).sort((a,b)=>a-b);
 const meta={...config,provider:'국립공원공단',sourceUrl:source.sourceUrl,endpoint:source.endpoint,fetchedAt:source.fetchedAt,refreshMethod:'공식 API 전체 수집; 자동 갱신 연결 전',count:rows.length,fields,dates:dates.length?[dates[0],dates.at(-1)]:null,years:[...new Set(years)],mapped:rows.filter(r=>r.p).length,coordinateValid:rows.filter(r=>r.lat!==null&&r.lon!==null).length,duplicateRows:duplicates,invalidDates:config.key==='roadkill'||config.key==='visitors'?rows.filter(r=>!r.d).length:null,invalidYears:config.key==='buildings'?rows.filter(r=>r.y===null).length:null,checksum:createHash('sha256').update(rawText).digest('hex')};
 if(config.key==='visitors'){const uniqueKeys=new Set();for(const r of source.data){const k=JSON.stringify([r['일자'],r['관리지구'],r['탐방지역']]);if(uniqueKeys.has(k))throw new Error('Ambiguous visitor point/date');uniqueKeys.add(k);}meta.points=[...new Set(rows.map(r=>r.l))].sort();meta.invalidValues=rows.filter(r=>r.v===null).length;}
 const output=JSON.stringify({meta,rows});if(secretValues.some(s=>output.includes(s)||output.includes(encodeURIComponent(s))))throw new Error('Secret detected in public output');
 await writeFile(new URL(`${config.key}.json`,directory),output,'utf8');manifest.datasets.push(meta);console.log(`${config.name}: ${rows.length} rows; ${meta.coordinateValid} valid coordinate pairs; ${duplicates} duplicate-content rows preserved`);
}
await writeFile(new URL('./site/data/manifest.json',import.meta.url),JSON.stringify(manifest),'utf8');
await copyFile(new URL('./lib.mjs',import.meta.url),new URL('./site/lib.mjs',import.meta.url));
await writeFile(new URL('./validation-result.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n','utf8');
