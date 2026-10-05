// Only production records site visits; local development and previews stay out.
const production=location.hostname==='knps-data.vercel.app';
if(production){
  window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};
  const script=document.createElement('script');script.defer=true;script.src='/_vercel/insights/script.js';document.head.append(script);
  const counter=document.getElementById('visitor-count');
  try{
    const response=await fetch('/api/visitors',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(data.status==='ok'&&Number.isSafeInteger(data.visitors)&&data.visitors>=0&&Number.isSafeInteger(data.pageviews)&&data.pageviews>=0){
      counter.textContent=`방문자 ${data.visitors.toLocaleString('ko-KR')} · 페이지 조회 ${data.pageviews.toLocaleString('ko-KR')}`;
      counter.title='Vercel Analytics 활성화 이후 기록 · 약 5분 간격 갱신 · 방문자 수는 Vercel 식별 기준';
      document.getElementById('visitor-period').textContent='집계 시작 이후 · Vercel Analytics';
    }else if(data.status==='not_configured'){counter.textContent='방문 통계: 집계 준비 중';}
    else{counter.textContent='방문 통계: 현재 조회 불가';}
  }catch{counter.textContent='방문 통계: 현재 조회 불가';}
}
