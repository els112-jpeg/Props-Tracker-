import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const SPORTS:Record<string,string[]>={
  nba:["KXNBAPRA","KXNBAPTS","KXNBAREB","KXNBAAST","KXNBA3PT","KXNBASTL","KXNBABLK","KXNBAGAME","KXNBASPREAD","KXNBATOTAL"],
  nfl:["KXNFLGAME","KXNFLSPREAD","KXNFLTOTAL","KXNFLPASSYDS","KXNFLRECYDS","KXNFLRUSHYDS"],
  ncaaf:["KXNCAAFGAME","KXNCAAFSPREAD","KXNCAAFTOTAL"],
  mlb:["KXMLBGAME","KXMLBSPREAD","KXMLBTOTAL"],
  nhl:["KXNHLGAME","KXNHLSPREAD","KXNHLTOTAL"],
  mls:["KXMLSGAME","KXMLSSPREAD","KXMLSTOTAL"],
};
const slim=(m:any)=>({ticker:m.ticker,event_ticker:m.event_ticker,title:m.title,yes_sub_title:m.yes_sub_title,
  yes_bid_dollars:m.yes_bid_dollars,yes_ask_dollars:m.yes_ask_dollars,no_bid_dollars:m.no_bid_dollars,no_ask_dollars:m.no_ask_dollars,
  last_price_dollars:m.last_price_dollars,yes_bid:m.yes_bid,yes_ask:m.yes_ask,last_price:m.last_price,
  volume:m.volume,close_time:m.close_time,floor_strike:m.floor_strike,result:m.result,status:m.status});
async function series(s:string){
  const out:any[]=[];let cursor="";
  for(let p=0;p<3;p++){
    const qs=new URLSearchParams({series_ticker:s,status:"open",limit:"1000"});if(cursor)qs.set("cursor",cursor);
    let d:any;try{const r=await fetch("https://api.elections.kalshi.com/trade-api/v2/markets?"+qs,{headers:{Accept:"application/json"}});if(!r.ok)break;d=await r.json()}catch(_e){break}
    for(const m of d.markets||[])out.push(slim(m));
    cursor=d.cursor||"";if(!cursor)break;
  }
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
    const b=await req.json().catch(()=>({}));const list=SPORTS[String(b.sport||"nba")]||SPORTS.nba;
    const parts=await Promise.all(list.map(series));
    return json({markets:parts.flat(),at:Date.now()});
  }catch(e){return json({error:String((e as Error).message||e)},500)}
});
