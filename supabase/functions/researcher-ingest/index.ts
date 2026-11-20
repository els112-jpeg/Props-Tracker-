import { createClient } from "jsr:@supabase/supabase-js@2";
// Daily Researcher bot -> Prop Grid. Auth: x-ingest-key header must equal the RESEARCHER_KEY secret.
// Body: {docs:{research:{...},predictions:[...],results:[...],scorecard:{...},skills:"markdown",briefing:"markdown"}}
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"x-ingest-key, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const DOCS=["research","predictions","results","scorecard","skills","briefing"];
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  try{
    const want=Deno.env.get("RESEARCHER_KEY")||"";
    const got=req.headers.get("x-ingest-key")||"";
    if(!want||got.length!==want.length||got!==want)return json({error:"Bad key"},401);
    const raw=await req.text();
    if(raw.length>1500000)return json({error:"Too large"},413);
    const b=JSON.parse(raw||"{}");
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email=(Deno.env.get("ALLOWED_EMAILS")||"").split(",")[0].trim().toLowerCase();
    if(!email)return json({error:"ALLOWED_EMAILS not set"},503);
    let uid="";
    for(let p=1;p<=10&&!uid;p++){
      const{data,error}=await sb.auth.admin.listUsers({page:p,perPage:200});
      if(error)throw error;
      const u=(data.users||[]).find((x:any)=>(x.email||"").toLowerCase()===email);
      if(u)uid=u.id;
      if(!data.users||data.users.length<200)break;
    }
    if(!uid)return json({error:"User not found"},404);
    const rows=[];
    for(const k of DOCS){
      if(b.docs&&b.docs[k]!==undefined){
        const v=b.docs[k];
        rows.push({user_id:uid,doc:k,body:(typeof v==="string")?{text:v}:Array.isArray(v)?{items:v}:v,updated_at:new Date().toISOString()});
      }
    }
    if(!rows.length)return json({error:"No docs"},400);
    const{error}=await sb.from("researcher_brain").upsert(rows,{onConflict:"user_id,doc"});
    if(error)throw error;
    return json({ok:true,saved:rows.map(r=>r.doc)});
  }catch(e){return json({error:String((e as Error).message||e)},500)}
});
