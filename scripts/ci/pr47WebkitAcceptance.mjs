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
    if(path==="/rest/v1/schedule_engine_history_sources"&&method==="GET")
      return respond([{source_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        source_label:"01. Horarios Janeiro 2026.xlsx",source_kind:"worked",
        time_zone:"Atlantic/Azores"}]);
    if(path==="/rest/v1/schedule_engine_history_day_facts"&&method==="GET"){
      const dateFrom=url.searchParams.get("work_date")??"";
      const from=dateFrom.startsWith("gte.")?dateFrom.slice(4):"";
      const to=(url.searchParams.getAll("work_date").find(x=>x.startsWith("lte."))??"").slice(4);
      const syntheticDay="2026-01-01";
      return respond(from<=syntheticDay&&to>=syntheticDay?[{
        source_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        person_id:personId,work_date:syntheticDay,
        occurrence_type:"holiday",shifts:[],
      }]:[]);
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
  // Calendar v2: compact information is opt-in, never hide archive failures.
  await page.getByRole("button",{name:"Informação do calendário"}).waitFor();
  const explanation=page.locator("#calendar-explanations");
  assert.equal(await explanation.isVisible(),false,
    "Long explanations must not dominate the initial calendar.");
  await page.getByRole("button",{name:"Informação do calendário"}).click();
  await explanation.getByText(/não representa aprovação oficial/).waitFor();
  await page.getByRole("button",{name:"Ocultar detalhes"}).click();
  assert.equal(await explanation.isVisible(),false,
    "Calendar context can be collapsed again.");
  await page.getByRole("region",{name:"Calendário mensal de horários"})
    .getByLabel("Resumo do mês").waitFor();

  // 21: all four real navigation areas and no retired interactive lab.
  const tabs=await page.locator(".app-nav-link").evaluateAll(
    elements=>elements.map(element=>element.getAttribute("aria-label")));
  assert.deepEqual(tabs,["Horários","Operação","Equipa","Regras"]);
  assert.equal(await page.locator(".workspace-tabs").count(),0,
    "Horizontal workspace tabs must be replaced by application navigation.");
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
  // 22/01: revisit primary areas and check displayed content reflects the
  // README's proposal-vs-approval boundary, not just domain helper output.
  await page.getByRole("button",{name:"Equipa",exact:true}).click();
  await page.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  await page.getByRole("button",{name:"Horários",exact:true}).click();
  await page.getByRole("button",{name:"+ Criar horário",exact:true}).click();
  await page.getByText(/Cada proposta válida é guardada no Supabase/).waitFor();
  await page.getByText(/Até 28 dias/).waitFor();
  await page.getByRole("heading",{name:"Nova proposta de horário"}).waitFor();
  const workflow=page.getByRole("list",{name:"Etapas do planeamento"});
  assert.equal(await workflow.locator("li").count(),3);
  assert.equal(await workflow.locator('button[aria-current="step"]').count(),1);
  assert.equal(await workflow.getByRole("button",{name:"Etapa 3: Consultar"}).isDisabled(),true,
    "The third stage must not open a proposal before a valid simulation.");
  await workflow.getByRole("button",{name:"Etapa 1: Preparar"}).click();
  await page.getByRole("heading",{name:"Gerar horário",exact:true}).waitFor();
  const presets=page.getByRole("group",{name:"Duração do período"});
  await presets.getByRole("button",{name:"14 dias"}).click();
  assert.equal(await presets.getByRole("button",{name:"14 dias"}).getAttribute("aria-pressed"),"true");
  assert.equal(await page.getByRole("button",{name:"Simular período com regras"}).isDisabled(),true,
    "Period presets must not bypass the explicit external-context confirmation.");
  await page.getByText("Confirma o contexto exterior").waitFor();
  const technical=page.locator(".generator-technical-details").first();
  assert.equal(await technical.locator("summary").isVisible(),true);

  await page.getByRole("button",{name:"← Voltar ao calendário mensal"}).click();
  await page.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  // Historical facts must be shown in the calendar itself, not as proposals.
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  await page.getByRole("button",{name:"Mês anterior"}).click();
  const januaryHeading=page.getByRole("heading",{name:/janeiro de 2026/i});
  await januaryHeading.waitFor();
  await page.locator(".se-day.history").waitFor();
  const factualDay=page.locator(".se-day.history");
  assert.match(await factualDay.innerText(),/Histórico/);
  await factualDay.click();
  await page.getByText("Histórico factual · importado").waitFor();
  await page.getByRole("button",{name:/Consultar histórico deste dia/}).click();
  await page.getByText("Feriado registado").waitFor();
  const daily=page.getByRole("region",{name:"Consulta do histórico factual"});
  await daily.getByRole("navigation",{name:"Navegação entre dias"}).waitFor();
  await daily.getByRole("button",{name:"Dia anterior"}).waitFor();
  await daily.getByRole("button",{name:"Dia seguinte"}).waitFor();
  assert.equal(await daily.locator(".se-daily-person-card").count(),1,
    "The historical roster must show one card per person and not infer absences.");
  await page.getByRole("button",{name:/Calendário mensal/}).click();
  await page.getByRole("button",{name:"Hoje"}).click();

  // App Shell: usable desktop navigation and mobile drawer, same workspaces.
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("region",{name:"Calendário mensal de horários"})
    .getByLabel("Resumo do mês").waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,
    "Mobile calendar must not force horizontal document scrolling.");

  const drawer=page.locator(".application-sidebar");
  assert.equal(await drawer.isVisible(),true,"Sidebar must stay mounted on mobile.");
  await page.getByRole("button",{name:"Abrir menu de navegação"}).click();
  await drawer.locator(".app-nav-link[aria-label='Equipa']").click();
  await page.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  assert.equal(await drawer.evaluate(el=>el.classList.contains("is-open")),false,
    "Selecting a mobile workspace must close the drawer.");
  await page.getByRole("button",{name:"Abrir menu de navegação"}).click();
  await drawer.locator(".app-nav-link[aria-label='Horários']").click();
  await page.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.locator(".app-nav-link").count(),4,
    "The same navigation structure is retained on desktop.");

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
