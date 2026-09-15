import appWorker from './customer-assets.js';

const STALE_MINUTES=15;
const ACTIVE_STATUSES=['Preparing','Generating Images','Packaging','Deploying','Verifying','Activating','Committing'];

async function recoverStaleBuilds(env){
  if(!env.DB)return;
  try{
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS concept_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT NOT NULL UNIQUE,
      prospect_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      previous_deployment_id TEXT,
      deployment_id TEXT,
      concept_alias TEXT,
      visual_family TEXT,
      visual_version TEXT,
      image_pipeline_version TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ready_at TEXT,
      alias_moved_at TEXT,
      completed_at TEXT,
      error_stage TEXT,
      error_message TEXT
    )`).run();
    const placeholders=ACTIVE_STATUSES.map(()=>'?').join(',');
    const stale=await env.DB.prepare(`SELECT p.id,p.business_name,p.concept_url,p.concept_build_id,cb.status,cb.started_at
      FROM prospects p
      LEFT JOIN concept_builds cb ON cb.build_id=p.concept_build_id
      WHERE p.concept_state='Building'
        AND (
          p.concept_build_id IS NULL OR cb.build_id IS NULL OR
          (cb.status IN (${placeholders}) AND cb.started_at < datetime('now',?)) OR
          cb.status NOT IN (${placeholders})
        )`).bind(...ACTIVE_STATUSES,`-${STALE_MINUTES} minutes`,...ACTIVE_STATUSES).all();
    const rows=stale.results||[];
    if(!rows.length)return;
    for(const row of rows){
      const message=`Previous concept build stopped before completion and was automatically released after ${STALE_MINUTES} minutes. You can retry the build.`;
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospects SET concept_state=CASE WHEN COALESCE(concept_url,'')<>'' THEN 'Built' ELSE 'Build Failed' END,concept_build_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND concept_state='Building'`).bind(message,row.id),
        row.concept_build_id?env.DB.prepare(`UPDATE concept_builds SET status='Failed',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),error_stage=COALESCE(error_stage,'Interrupted'),error_message=COALESCE(error_message,?) WHERE build_id=? AND status IN (${placeholders})`).bind(message,row.concept_build_id,...ACTIVE_STATUSES):env.DB.prepare('SELECT 1')
      ]);
      try{await env.DB.prepare(`INSERT INTO admin_activity (customer_id,event_type,description,metadata_json,created_at) VALUES (NULL,'concept_build',?,?,CURRENT_TIMESTAMP)`).bind(`Released stale concept build for ${row.business_name}`,JSON.stringify({prospect_id:row.id,build_id:row.concept_build_id||null,previous_status:row.status||null,started_at:row.started_at||null,stale_after_minutes:STALE_MINUTES})).run()}catch{}
    }
  }catch(e){console.warn('Stale concept build recovery skipped',String(e?.message||e))}
}

function shouldRecover(request){
  if(request.method!=='GET')return false;
  const path=new URL(request.url).pathname;
  return path==='/api/admin/prospects'||path==='/api/admin/dashboard-summary'||/^\/api\/admin\/prospects\//.test(path);
}

export default{async fetch(request,env,context){
  if(shouldRecover(request))await recoverStaleBuilds(env);
  return appWorker.fetch(request,env,context);
}};
