/**
 * PR47: automated UI evidence in WebKit, Safari's browser engine, on a FREE
 * disposable GitHub runner. The backend is fully synthetic and intercepted
 * by Playwright. No production users, Supabase keys, data or writes.
 *
 * Covers exact browser interactions for 01, 14, 15, 18, 19, 21 and 22.
 * Running WebKit on Linux is NOT equivalent to testing native macOS Safari.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {webkit} from "playwright";

const origin="http://127.0.0.1:4174";
const api="https://audit-fixture.supabase.co";
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const personId="one-person";
const personName="Colaborador de Ensaio";
const weekday=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const emptyHours=Object.fromEntries(weekday.map(day=>[day,[]]));
const initialHours={...emptyHours,monday:[{start:"09:00",end:"13:00"}]};
let persisted={
  version:4,
  operationTimeZone:"Atlantic/Azores",
  weeklyOperatingHours:initialHours,
  exceptions:[],
  people:[{id:personId,name:personName,active:true}],
  availabilities:[{
    personId,
    weeklyAvailability:initialHours,
    exceptions:[],
  }],
  workRules:{standardShiftDurationMinutes:240},
  weeklyPresenceRequirements:Object.fromEntries(weekday.map(day=>
    [day,day==="monday"?{
      minimumAtOpening:1,minimumDuringOperation:1,minimumAtClosing:1,
    }:null])),
  presenceExceptions:[],
};
let revision=1,failNextSave=false,saves=0;
const server=spawn(process.execPath,[
  "./node_modules/vite/bin/vite.js","--host","127.0.0.1",
  "--port","4174","--strictPort",
],{
  env:{
    ...process.env,VITE_SUPABASE_URL:api,
    VITE_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_synthetic_not_a_real_key",
  },
  stdio:["ignore","pipe","pipe"],
});
let serverOutput="";
for(const stream of [server.stdout,server.stderr])
  stream.on("data",chunk=>{serverOutput+=String(chunk).slice(-1800);});
let browser;
const errors=[];
const wait=async(predicate,label,ms=20000)=>{
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    if(await predicate())return;
    await delay(120);
  }
  throw Error("Timed out waiting for "+label);
};
const matches=(actual,expected,label)=>assert.equal(actual,expected,label);
try{
  await wait(async()=>{
    try{return (await fetch(origin)).ok;}catch{return false;}
  },"isolated Vite");
  browser=await webkit.launch({headless:true});
  const context=await browser.newContext({locale:"pt-PT",timezoneId:"Atlantic/Azores"});
  const session={
    access_token:"synthetic-jwt-never-sent-to-supabase",
    refresh_token:"synthetic-refresh",
    expires_at:4102444800,
    user:{id:owner,email:"synthetic@example.invalid"},
  };
  await context.addInitScript(({key,session,origin})=>{
    if(window.location.origin===origin)
      window.localStorage.setItem(key,JSON.stringify(session));
  },{key:"schedule-engine:supabase:session:v1",session,origin});
  await context.route(api+"/**",async route=>{
    const request=route.request(),url=new URL(request.url());
    const path=url.pathname,method=request.method();
    const options={
      headers:{
        "access-control-allow-origin":"*",
        "access-control-allow-headers":"authorization,apikey,content-type,x-client-info",
        "access-control-allow-methods":"GET,POST,OPTIONS",
      },
      contentType:"application/json",
    };
    const respond=async(body,status=200)=>route.fulfill({
      ...options,status,body:JSON.stringify(body),
    });
    if(method==="OPTIONS"){
      await route.fulfill({...options,status:204,body:""});return;
    }
    if(path==="/auth/v1/user")return respond({id:owner,email:session.user.email,is_anonymous:false});
    if(path==="/rest/v1/schedule_engine_states"&&method==="GET")
      return respond([{revision,payload:structuredClone(persisted)}]);
    if(path==="/rest/v1/rpc/save_schedule_engine_state"&&method==="POST"){
      if(failNextSave){
        failNextSave=false;
        await respond({code:"synthetic_network_interruption",message:"Simulated aborted write"},503);
        return;
      }
      const incoming=JSON.parse(request.postData()??"{}");
      if(incoming.p_expected_revision!==revision)
        return respond({code:"40001",message:"Stale revision"},409);
      assert.equal(incoming.p_payload?.version,4);
      persisted=structuredClone(incoming.p_payload);
      revision++;
      saves++;
      return respond(revision);
    }
    if(path==="/rest/v1/schedule_engine_generated_schedules"&&method==="GET")
      return respond([]);
    if(path==="/functions/v1/official-schedules-v2")
      return respond({ready:false,alreadyApproved:false,version:null,
        historyStatus:"incomplete_context",message:"Histórico por verificar."});
    throw Error("Unexpected synthetic route "+method+" "+path);
  });
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-09T12:00:00Z"));
  await page.goto(origin,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  await page.locator(".save-status.saved").waitFor();
  // 21: all four real navigation areas and no retired interactive lab.
  const tabs=await page.locator(".workspace-tabs button").allTextContents();
  assert.deepEqual(tabs.map(x=>x.trim()),
    ["Horários","Operação","Equipa","Regras"]);
  assert(!/(?:laborat[oó]rio|approved context integration lab)/i.test(
    await page.locator("body").innerText()),"Retired lab leaked into UI");
  // 22: proposal terminology is not an official approval.
  assert.match(await page.locator("body").innerText(),
    /São propostas, não escalas oficialmente aprovadas/);
  // 01: the operational documentation must claim 28, NOT 14 days.
  await page.getByRole("button",{name:"Operação",exact:true}).click();
  const operation=page.getByRole("region",{name:"Configuração temporal da operação"});
  await operation.getByText(/até 28 dias por proposta/).waitFor();
  assert(!/14 dias por proposta/.test(await operation.innerText()));
  // 15: Europe/Lisbon must persist through a real WebKit reload.
  await operation.getByLabel("Fuso horário IANA").fill("Europe/Lisbon");
  await operation.getByRole("button",{name:"Aplicar fuso horário"}).click();
  await wait(()=>persisted.operationTimeZone==="Europe/Lisbon",
    "time zone persisted by cloud RPC");
  // 18: a 28-day accounting anchor must cross Nov/Dec in the real calendar.
  await operation.getByLabel(/Início de um ciclo fixo de 28 dias/)
    .fill("2026-11-02");
  await wait(()=>persisted.cycleAnchorDate==="2026-11-02",
    "28-day anchor persisted");
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  await page.getByRole("button",{name:"Operação",exact:true}).click();
  matches(await operation.getByLabel("Fuso horário IANA").inputValue(),
    "Europe/Lisbon","Timezone must survive reload.");
  matches(await operation.getByLabel(/Início de um ciclo fixo de 28 dias/)
    .inputValue(),"2026-11-02","Cycle anchor must survive reload.");
  await page.getByRole("button",{name:"Horários",exact:true}).click();
  await page.locator('button.se-day[aria-label^="29 de novembro"]')
    .click();
  await page.getByText("2026-11-02 a 2026-11-29 · semana 4/4")
    .waitFor();
  await page.locator('button.se-day[aria-label^="30 de novembro"]')
    .click();
  await page.getByText("2026-11-30 a 2026-12-27 · semana 1/4")
    .waitFor();
  // 19: the exact contract 20h / goal 15h / mandatory date must persist.
  await page.getByRole("button",{name:"Regras",exact:true}).click();
  const hard=page.getByLabel("Máximo contratual (h/semana)");
  await hard.fill("20");
  await wait(()=>persisted.people[0].weeklyContractMinutes===1200,
    "20h hard contract saved");
  const soft=page.getByLabel("Objetivo semanal (h)");
  await soft.fill("15");
  await wait(()=>persisted.people[0].weeklyTargetMinutes===900,
    "15h soft target saved");
  await page.getByLabel("Dia obrigatório (data civil)")
    .fill("2026-11-16");
  await page.getByRole("button",{name:"Adicionar",exact:true}).click();
  await wait(()=>persisted.people[0].requiredWorkDates?.includes("2026-11-16"),
    "mandatory day saved");
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  await page.getByRole("button",{name:"Regras",exact:true}).click();
  matches(await page.getByLabel("Máximo contratual (h/semana)").inputValue(),
    "20","Hard contract persisted in UI.");
  matches(await page.getByLabel("Objetivo semanal (h)").inputValue(),
    "15","Soft target persisted in UI.");
  await page.getByTitle("Remover a obrigação de 2026-11-16").waitFor();
  // 14: rejected network write cannot claim success, must offer JSON export.
  await page.getByRole("button",{name:"Operação",exact:true}).click();
  failNextSave=true;
  await page.getByLabel(/Início de um ciclo fixo de 28 dias/)
    .fill("2026-11-09");
  await page.getByRole("heading",{name:"Não foi possível sincronizar a configuração"})
    .waitFor({timeout:10000});
  await page.getByRole("button",{
    name:"Descarregar cópia das alterações pendentes (JSON)",
  }).waitFor();
  matches(persisted.cycleAnchorDate,"2026-11-02",
    "Unacknowledged write must not replace the server baseline.");
  assert(saves>=4,"Real UI must have persisted multiple independent changes.");
  assert.equal(errors.length,0,"No browser errors: "+errors.join("; "));
  console.log("PR47 WebKit: 01 documentation limit, 14 failed write warning, 15 persisted zone, 18 29/30 cycle, 19 person policy persistence, 21 retired UI, 22 terminology PASS (synthetic backend).");
}finally{
  if(browser)await browser.close();
  server.kill("SIGTERM");
  if(serverOutput&&process.env.PR47_DEBUG_WEBKIT)console.log(serverOutput);
}
