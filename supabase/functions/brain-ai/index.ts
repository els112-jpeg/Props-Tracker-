import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  try{
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")||""}}});
    const{data:{user}}=await sb.auth.getUser();
    if(!user)return json({error:"Not signed in"},401);
    const allowed=(Deno.env.get("ALLOWED_EMAILS")||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(!allowed.length||!allowed.includes((user.email||"").toLowerCase()))return json({error:"Not allowed"},403);
    const key=Deno.env.get("ANTHROPIC_API_KEY");
    if(!key)return json({error:"ANTHROPIC_API_KEY secret is not set in Supabase"},503);
    const b=await req.json().catch(()=>({}));
    const q=String(b.question||"").slice(0,500);
    const ctx=JSON.stringify({stats:b.stats,skills:b.skills,picks:b.picks}).slice(0,12000);
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({
      model:"claude-sonnet-5-5",max_tokens:700,
      system:"You are the Brain inside a personal NBA player-prop tracker for Kalshi bets. You get the user's own settled-bet stats, the skills computed from them, and open-market picks (chance = Kalshi price). Be direct and concise (under 180 words, mobile screen). Point out real patterns and weaknesses, push back on flawed habits (e.g. many-leg combos multiply risk down), say when the sample is too small, never promise wins, never claim certainty. This is not financial advice.",
      messages:[{role:"user",content:"DATA:\n"+ctx+"\n\n"+(q?"QUESTION: "+q:"Give me your read: what am I doing well, what's costing me, and which 2-3 open picks fit me best and why.")}]})});
    const d=await r.json();
    if(!r.ok)return json({error:"AI error "+r.status+": "+(d?.error?.message||"").slice(0,200)},502);
    return json({text:(d.content||[]).map((c:any)=>c.text||"").join("")});
  }catch(e){return json({error:String((e as Error).message||e)},500)}
});
