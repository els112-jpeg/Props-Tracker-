import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});

const MAIN_SYSTEM="You are the Brain inside a personal NBA player-prop tracker for Kalshi bets. You get the user's own settled-bet stats, skills with measured lift, open picks (brain_pct = blend of market price and a form/opponent/streak model; market_pct = Kalshi price), longshot swing shots, your own calibration record, a bankroll plan with suggested stakes, a backtest of the model, price tracking and injury counts. Respect the plan: if it says no bet, say sit out. Never suggest stakes above the plan. Start with one plain-English line beginning 'TL;DR:' (max 25 words, no jargon, like telling a friend), then a short breakdown. Be direct and concise (under 200 words total, mobile screen). Do real risk analysis: weigh hot/cold streaks, history vs the opponent, volatility, and whether brain_pct beats market_pct. You may present bigger-swing picks when the estimated edge is real, but always state the hit chance and that most longshots miss, and suggest small sizing. If calibration shows the Brain is no better than the market, say so and lean on market prices. Push back on flawed habits such as long combos. Say when samples are small. The user's chosen trade tilt is in discipline.tilt (passive, neutral or aggressive): match your risk appetite to it (passive favors safer, fewer legs; aggressive is more willing to present bigger swings), but never exceed the plan's stake caps and never overstate the odds. Never promise wins. This is not financial advice.";

const RESEARCHER_NOTE=" If researcher_intel is present, it comes from a separate Researcher bot that reads sports news daily and keeps its own track record (its scorecard). Treat it as outside intel, not fact: weigh each item by its stated confidence and status (confirmed beats reported beats conflicting/rumor), and by how well its scorecard says it has done (if fewer than 20 graded calls, say its record is unproven). Use it to adjust risk on injuries and usage, say plainly when it agrees or conflicts with the model, and never let it raise stakes above the plan.";

const RESEARCHER_SYSTEM="You are the Researcher, a bot inside a personal NBA player-prop tracker for Kalshi bets. Every day you read sports coverage (injury reports, lineups, minutes, matchups, line moves) and file structured signals, then keep a scorecard grading your own past predictions. You do not place bets; you inform the Brain and the user. You get your own data (briefing, signals with status_class confirmed/reported/conflicting/rumor and confidence, open predictions, scorecard, lessons) and, when available, the Brain's open picks with brain_pct and market_pct. Rules: separate confirmed facts from reports and rumor; call out conflicting sources; connect each signal to the markets it moves (points, rebounds, assists, PRA, team totals) and the direction; cite signal ids like S012; state your confidence honestly and say your record is unproven if scorecard.graded is under 20; if data is stale (check run_date vs today) say so; never invent stats or lines you were not given; never promise wins; this is not financial advice. Be direct and concise (under 220 words, mobile screen). For a normal reply start with one plain line beginning 'TL;DR:' (max 25 words). When asked for a council memo, use exactly three headed lists: BOOST (picks the news supports), AVOID (picks the news hurts), WATCH (status pending); each item: player, side, line, one-sentence reason, confidence 0-100, signal ids; finish with one line on what you are unsure about.";

async function loadResearcher(sb:any){
  const{data,error}=await sb.from("researcher_brain").select("doc,body,updated_at");
  if(error||!data)return null;
  const d:Record<string,any>={};data.forEach((r:any)=>d[r.doc]=r);
  return d;
}
const cut=(s:any,n:number)=>String(s||"").slice(0,n);
function compactResearcher(d:Record<string,any>|null,full:boolean){
  if(!d||!Object.keys(d).length)return null;
  const rs=d.research?.body||{};
  const sig=(rs.signals||[]) as any[];
  const nba=sig.filter(s=>s.league==="NBA").sort((a,b)=>(b.confidence||0)-(a.confidence||0));
  const oth=sig.filter(s=>s.league!=="NBA").slice(0,full?8:3);
  const pick=(s:any)=>({id:s.id,team:s.team,player:s.player,type:s.signal_type,status:s.status_class,conf:s.confidence,summary:cut(s.summary,full?240:160),impacts:(s.impacts||[]).slice(0,2).map((i:any)=>(i.market||"")+": "+(i.direction||""))});
  const preds=((d.predictions?.body?.items)||[]) as any[];
  const res=((d.results?.body?.items)||[]) as any[];
  const doneIds=new Set(res.map((r:any)=>r.id||r.prediction_id));
  const open=preds.filter(p=>!doneIds.has(p.id)).slice(0,full?20:8).map(p=>({id:p.id,subject:p.subject,market:p.market,direction:p.predicted_direction,conf:p.confidence}));
  const out:any={run_date:rs.run_date,filed_at:d.research?.updated_at,scorecard:d.scorecard?.body,signals:[...nba.slice(0,full?30:12),...oth].map(pick),open_predictions:open};
  if(full){out.nba_slate=(rs.slate?.["NBA_"+(rs.run_date||"")]||[]).slice(0,12);out.notes=rs.notes;out.briefing=cut(d.briefing?.body?.text,1500);out.lessons=cut(d.skills?.body?.text,1500);out.recent_results=res.slice(-12)}
  return out;
}

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
    const q=String(b.question||"").slice(0,900);
    const mode=b.mode==="researcher"||b.mode==="council"?b.mode:"main";
    const model=Deno.env.get("BRAIN_MODEL")||"claude-haiku-5-5";
    const call=async(system:string,content:string,max=800)=>{
      const go=(m:string)=>fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:m,max_tokens:max,system,messages:[{role:"user",content}]})});
      let r=await go(model);
      if(r.status===404&&!Deno.env.get("BRAIN_MODEL"))r=await go("claude-haiku-4-5");
      const d=await r.json();
      if(!r.ok)throw new Error("AI error "+r.status+": "+(d?.error?.message||"").slice(0,200));
      return (d.content||[]).map((c:any)=>c.text||"").join("");
    };
    const mainCtx=(extra?:Record<string,unknown>)=>JSON.stringify({...(extra||{}),combo:b.combo,stats:b.stats,skills:b.skills,picks:b.picks,swings:b.swings,calibration:b.calibration,target_multiplier:b.target_multiplier,slip:b.slip,discipline:b.discipline}).slice(0,16000);
    const mainAsk=q?"QUESTION: "+q:"Give me your read: what am I doing well, what's costing me, which 2-3 open picks fit best and why, and is there one swing shot worth a small bet?";
    const RD=(mode==="main"&&b.use_researcher===false)?null:await loadResearcher(sb);

    if(mode==="researcher"){
      const ctx=JSON.stringify({today:new Date().toISOString().slice(0,10),researcher:compactResearcher(RD,true),brain_open_picks:(b.picks||[]).slice(0,12)}).slice(0,14000);
      if(!RD||!Object.keys(RD).length)return json({text:"TL;DR: I have no filed research yet. Run the daily Researcher or import its files in the Researcher view."});
      const text=await call(RESEARCHER_SYSTEM,"DATA:\n"+ctx+"\n\n"+(q?"QUESTION: "+q:"Give me today's read: the 3 most important signals for my NBA player props and what to do about them."));
      return json({text});
    }

    if(mode==="council"){
      const rctx=JSON.stringify({today:new Date().toISOString().slice(0,10),researcher:compactResearcher(RD,true),brain_open_picks:(b.picks||[]).slice(0,12),brain_swings:(b.swings||[]).slice(0,5)}).slice(0,14000);
      const memo=RD&&Object.keys(RD).length
        ?await call(RESEARCHER_SYSTEM,"DATA:\n"+rctx+"\n\nWrite a COUNCIL MEMO for the Brain now (BOOST / AVOID / WATCH)."+(q?" The user also asks: "+q:""),700)
        :"No filed research available.";
      const text=await call(MAIN_SYSTEM+RESEARCHER_NOTE+" You are in a council: the Researcher's memo is in researcher_memo. Begin with 'TL;DR:' giving the final call, then say in one or two lines where you agree and where you disagree with the Researcher, then the final choices (respect the plan and stake caps).","DATA:\n"+mainCtx({researcher_memo:memo,researcher_scorecard:RD?.scorecard?.body})+"\n\n"+mainAsk);
      return json({text,researcher:memo});
    }

    const intel=compactResearcher(RD,false);
    const text=await call(MAIN_SYSTEM+(intel?RESEARCHER_NOTE:""),"DATA:\n"+mainCtx(intel?{researcher_intel:intel}:{})+"\n\n"+mainAsk);
    return json({text,used_researcher:!!intel});
  }catch(e){
    const m=String((e as Error).message||e);
    return json({error:m},m.startsWith("AI error")?502:500);
  }
});
