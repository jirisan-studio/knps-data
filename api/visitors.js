// Vercel credentials stay in server environment variables, never in site/.
export function createVisitorHandler({env=process.env,fetcher=fetch}={}) {
  return async function handler(req,res) {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({status:'method_not_allowed'});}
    if(new URL(req.url,'https://local.invalid').search)return res.status(400).json({status:'invalid_request'});
    const token=env.VERCEL_ANALYTICS_TOKEN,project=env.VERCEL_ANALYTICS_PROJECT_ID;
    if(!token||!/^prj_[a-zA-Z0-9]+$/.test(project??''))return res.status(200).json({status:'not_configured'});
    const url=new URL('https://api.vercel.com/v1/query/web-analytics/visits/count');
    url.searchParams.set('projectId',project);
    url.searchParams.set('slug',env.VERCEL_ANALYTICS_TEAM_SLUG||'naturekr-5699s-projects');
    try {
      const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok){await response.body?.cancel();return res.status(200).json({status:'unavailable'});}
      const payload=await response.json(),data=payload?.data;
      if(!Number.isSafeInteger(data?.visitors)||data.visitors<0||!Number.isSafeInteger(data?.pageviews)||data.pageviews<0)return res.status(200).json({status:'unavailable'});
      res.setHeader('Cache-Control','public, max-age=0, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({status:'ok',visitors:data.visitors,pageviews:data.pageviews,updatedAt:new Date().toISOString(),period:'since_analytics_enabled'});
    } catch {return res.status(200).json({status:'unavailable'});}
  };
}
export default createVisitorHandler();
