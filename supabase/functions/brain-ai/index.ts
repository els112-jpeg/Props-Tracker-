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
    const ctx=JSON.stringify({stats:b.stats,skills:b.skills,picks:b.picks,swings:b.swings,calibration:b.calibration}).slice(0,16000);
    const model=Deno.env.get("BRAIN_MODEL")||"claude-haiku-5-5";
    const system="You are the Brain inside a personal NBA player-prop tracker for Kalshi bets. You get the user's own settled-bet stats, skills with measured lift, open picks (brain_pct = blend of market price and a form/opponent/streak model; market_pct = Kalshi price), longshot swing shots, and your own calibration record. Be direct and concise (under 200 words, mobile screen). Do real risk analysis: weigh hot/cold streaks, history vs the opponent, volatility, and whether brain_pct beats market_pct. You may present bigger-swing picks when the estimated edge is real, but always state the hit chance and that most longshots miss, and suggest small sizing. If calibration shows the Brain is no better than the market, say so and lean on market prices. Push back on flawed habits such as long combos. Say when samples are small. Never promise wins. This is not financial advice.";
    const msgs=[{role:"user",content:"DATA:\n"+ctx+"\n\n"+(q?"QUESTION: "+q:"Give me your read: what am I doing well, what's costing me, which 2-3 open picks fit best and why, and is there one swing shot worth a small bet?")}];
    const call=(m:string)=>fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:m,max_tokens:800,system,messages:msgs})});
    let r=await call(model);
    if(r.status===404&&!Deno.env.get("BRAIN_MODEL"))r=await call("claude-haiku-4-5");
    const d=await r.json();
    if(!r.ok)return json({error:"AI error "+r.status+": "+(d?.error?.message||"").slice(0,200)},502);
    return json({text:(d.content||[]).map((c:any)=>c.text||"").join("")});
  }catch(e){return json({error:String((e as Error).message||e)},500)}
});
