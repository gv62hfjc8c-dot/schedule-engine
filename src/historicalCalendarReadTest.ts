import {createHistoricalDayRepository,historicalDayTotals} from "./persistence/supabaseHistoricalDayRepository";
import type {SupabaseAuthClient} from "./persistence/supabaseAuth";
const OWNER="11111111-1111-4111-8111-111111111111";
const SOURCE="22222222-2222-4222-8222-222222222222";
let mode:"normal"|"duplicate"|"broken"|"unauthorized"="normal";
const calls:string[]=[];
const client={
  user:{id:OWNER,email:"a@example.test"},
  request:async (path:string)=>{
    calls.push(path);
    if(mode==="unauthorized")return new Response("{}",{status:401});
    const rows=path.includes("history_sources")?[
      {source_id:SOURCE,source_label:"01. Horarios Janeiro 2026.xlsx",source_kind:"worked",time_zone:"Atlantic/Azores"}
    ]:[
      {source_id:SOURCE,person_id:"a",work_date:"2026-01-01",
       occurrence_type:"holiday",shifts:[]},
      {source_id:SOURCE,person_id:"a",work_date:"2026-01-02",
       occurrence_type:"worked",shifts:[{date:"2026-01-02",personId:"a",
         interval:{start:"09:00",end:"18:00"},mealBreak:{start:"13:00",end:"14:00"}}]},
      ...(mode==="duplicate"?[{source_id:SOURCE,person_id:"a",work_date:"2026-01-02",
        occurrence_type:"day_off",shifts:[]}]:[]),
      ...(mode==="broken"?[{source_id:SOURCE,person_id:"b",work_date:"2026-01-03",
        occurrence_type:"worked",shifts:[]}]:[]),
    ];
    return new Response(JSON.stringify(rows),{status:200,headers:{"Content-Type":"application/json"}});
  },
} as unknown as Pick<SupabaseAuthClient,"user"|"request">;
const assert=(ok:boolean,message:string)=>{if(!ok)throw Error(message);};
const reader=createHistoricalDayRepository(client);
const rows=await reader.listBetween("2026-01-01","2026-01-31");
assert(rows.length===2,"Historical read must retain only two explicit facts.");
assert(historicalDayTotals(rows,"2026-01-01").holiday===1,
  "A public holiday appears as historical fact, not as planned absence.");
assert(historicalDayTotals(rows,"2026-01-02").worked===1,
  "A continuous shift with meal is preserved.");
assert(rows[1].shifts[0].mealBreak?.start==="13:00"&&
       rows[1].shifts.length===1,
  "The meal does not create two shifts.");
assert(historicalDayTotals(rows,"2026-01-03").total===0,
  "No row is unknown, not a confirmed day off.");
assert(calls.every(path=>path.includes("owner_id=eq."+OWNER)),
  "All historical reads are owner-scoped.");
mode="duplicate";
await reader.listBetween("2026-01-01","2026-01-31").then(
  ()=>{throw Error("Overlapping sources must be rejected.");},
  ()=>undefined,
);
mode="broken";
await reader.listBetween("2026-01-01","2026-01-31").then(
  ()=>{throw Error("A worked day without a shift must be rejected.");},
  ()=>undefined,
);
mode="unauthorized";
await reader.listBetween("2026-01-01","2026-01-31").then(
  ()=>{throw Error("Unauthorized read must fail closed.");},
  ()=>undefined,
);
console.log("Historical month adapter: typed facts, meal break, unknown days, owner scoping and fail-closed checks passed.");
