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
  // PR58: authenticate screen is real responsive UI, not a Supabase developer form.
  const loginContext=await browser.newContext({locale:"pt-PT",timezoneId:"Atlantic/Azores",
    viewport:{width:1440,height:900}});
  await loginContext.route(api+"/**",async route=>{
    const url=new URL(route.request().url());
    const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type"};
    if(route.request().method()==="OPTIONS")
      return route.fulfill({status:204,headers:cors});
    if(url.pathname==="/auth/v1/token")return route.fulfill({
      status:400,headers:cors,contentType:"application/json",
      body:JSON.stringify({message:"Invalid login credentials"}),
    });
    return route.fulfill({status:401,headers:cors,contentType:"application/json",body:"{}"});
  });
  const loginPage=await loginContext.newPage();
  await loginPage.goto(origin);
  await loginPage.getByRole("heading",{name:"Bem-vindo de volta"}).waitFor();
  assert.equal(await loginPage.getByText("Authentication → Users").count(),0,
    "Developer configuration instructions must not appear to customers.");
  await loginPage.getByRole("textbox",{name:"Email"}).fill("teste@example.com");
  await loginPage.locator("#supabase-password").fill("wrong-pass");
  await loginPage.getByRole("button",{name:"Mostrar palavra-passe"}).click();
  assert.equal(await loginPage.locator("#supabase-password").getAttribute("type"),"text");
  await loginPage.getByRole("button",{name:"Ocultar palavra-passe"}).click();
  assert.equal(await loginPage.locator("#supabase-password").getAttribute("type"),"password");
  await loginPage.getByRole("button",{name:"Entrar no Schedule Engine"}).click();
  await loginPage.getByRole("alert").getByText(/Email ou palavra-passe incorretos/).waitFor();
  assert.equal(await loginPage.getByRole("heading",{name:"Bem-vindo de volta"}).isVisible(),true,
    "A failed login must remain on the sign-in screen.");
  await loginPage.setViewportSize({width:390,height:844});
  assert.equal(await loginPage.getByRole("heading",{name:"Bem-vindo de volta"}).isVisible(),true);
  assert.equal(await loginPage.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,
    "Mobile login must never overflow horizontally.");
  await loginContext.close();
  // PR59: first-use choice must not masquerade as a synchronization failure.
  const onboarding=await browser.newContext({locale:"pt-PT",timezoneId:"Atlantic/Azores"});
  const oldBrowserState={
    version:1,weeklyOperatingHours:initialHours,exceptions:[],
    people:[{id:personId,name:personName,active:true}],
  };
  const legacySession={
    access_token:"synthetic-jwt-never-sent-to-supabase",
    refresh_token:"synthetic-refresh",expires_at:4102444800,
    user:{id:owner,email:"synthetic@example.invalid"},
  };
  await onboarding.addInitScript(({origin,session,legacy})=>{
    if(window.location.origin===origin){
      localStorage.setItem("schedule-engine:supabase:session:v1",JSON.stringify(session));
      localStorage.setItem("schedule-engine:app-state:v1",JSON.stringify(legacy));
    }
  },{origin,session:legacySession,legacy:oldBrowserState});
  await onboarding.route(api+"/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const cors={"access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,apikey,content-type",
      "access-control-allow-methods":"GET,POST,OPTIONS"};
    if(request.method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
    if(path==="/auth/v1/user")return route.fulfill({
      status:200,headers:cors,contentType:"application/json",
      body:JSON.stringify({id:owner,email:legacySession.user.email,is_anonymous:false}),
    });
    if(path==="/rest/v1/schedule_engine_states")return route.fulfill({
      status:200,headers:cors,contentType:"application/json",body:"[]",
    });
    if(request.method()==="GET")return route.fulfill({
      status:200,headers:cors,contentType:"application/json",body:"[]",
    });
    return route.fulfill({status:503,headers:cors,contentType:"application/json",
      body:'{"message":"Unexpected write during onboarding"}'});
  });
  const firstUse=await onboarding.newPage();
  await firstUse.goto(origin);
  await firstUse.getByRole("heading",{name:"Como queres começar?"}).waitFor();
  assert.equal(await firstUse.getByRole("heading",{name:/sincronizar a configuração/i}).count(),0);
  const importChoice=firstUse.getByRole("button",{name:"Importar a minha configuração"});
  assert.equal(await importChoice.isDisabled(),true,
    "Import must not be possible without ownership confirmation.");
  await firstUse.getByRole("checkbox",{
    name:/Confirmo que sou o proprietário dos dados antigos/
  }).check();
  assert.equal(await importChoice.isEnabled(),true,
    "Explicit ownership confirmation unlocks only the import action.");
  await firstUse.getByRole("button",{name:"Começar do zero"}).click();
  await firstUse.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  assert.equal(await firstUse.evaluate(()=>localStorage.getItem(
    "schedule-engine:app-state")!==null),true,
    "Starting from scratch must never delete old browser data.");
  assert.equal(await firstUse.evaluate(id=>localStorage.getItem(
    "schedule-engine:legacy-import:skip-owner:"+id),owner),"skip",
    "The fresh-account decision must be scoped to the authenticated owner.");
  await onboarding.close();

  // A true load failure must retain a separate fail-closed error screen.
  const failedLoad=await browser.newContext({locale:"pt-PT",timezoneId:"Atlantic/Azores"});
  await failedLoad.addInitScript(({origin,session})=>{
    if(window.location.origin===origin)
      localStorage.setItem("schedule-engine:supabase:session:v1",JSON.stringify(session));
  },{origin,session:legacySession});
  await failedLoad.route(api+"/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const headers={"access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,apikey,content-type",
      "access-control-allow-methods":"GET,POST,OPTIONS"};
    if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(path==="/auth/v1/user")return route.fulfill({
      status:200,headers,contentType:"application/json",
      body:JSON.stringify({id:owner,email:legacySession.user.email,is_anonymous:false}),
    });
    return route.fulfill({status:503,headers,contentType:"application/json",
      body:'{"message":"Service temporarily unavailable"}'});
  });
  const failedPage=await failedLoad.newPage();
  await failedPage.goto(origin);
  await failedPage.getByRole("heading",{name:"Não foi possível carregar a configuração"}).waitFor();
  assert.equal(await failedPage.getByRole("button",{name:"Começar do zero"}).count(),0,
    "A service outage must never authorize starting an empty account.");
  await failedLoad.close();

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
  // PR63: selecting no cycle is an explicit action, not an empty date input.
  const cycle=operation.getByRole("group",{name:"Escolher ciclo de trabalho"});
  const guide=page.getByRole("region",{name:"Configuração inicial guiada"});
  await operation.getByText("Por decidir no onboarding").waitFor();
  await operation.getByRole("button",{name:"Escolher ciclo"}).click();
  await page.getByText("Escolha do ciclo por guardar").waitFor();
  assert.equal(persisted.onboarding?.cycleDecisionConfirmed,undefined,
    "Opening the draft must not persist an unconfirmed cycle.");
  await cycle.getByRole("button",{name:"Cancelar"}).click();
  assert.equal(await page.getByText("Escolha do ciclo por guardar").count(),0);
  await operation.getByRole("button",{name:"Escolher ciclo"}).click();
  await cycle.getByRole("radio",{name:"Não, sem ciclo fixo"}).check();
  await cycle.getByRole("button",{name:"Guardar escolha do ciclo"}).click();
  await wait(()=>persisted.onboarding?.cycleDecisionConfirmed===true,
    "Explicitly declining a cycle persists in the cloud");
  assert.equal(persisted.cycleAnchorDate,undefined,"No artificial anchor when no cycle.");
  assert.equal(persisted.accountingCycleDays,undefined,"No duration when no cycle.");
  await operation.getByText("Sem ciclo fixo",{exact:true}).waitFor();
  await page.locator(".save-status.saved").waitFor();
  await guide.getByRole("button",{name:"Ver etapas"}).click();
  await guide.getByRole("button",{name:"Confirmar funcionamento"}).click();
  await wait(()=>Boolean(persisted.onboarding?.operationConfirmedFingerprint),
    "Operation onboarding confirmation persisted");
  await guide.getByText("1 de 5").waitFor();
  await page.locator(".save-status.saved").waitFor();
  // 14-day cycle: explicit selection and anchor, invalidating prior confirmation.
  await operation.getByRole("button",{name:"Alterar ciclo"}).click();
  await cycle.getByRole("radio",{name:"Sim, utiliza um ciclo"}).check();
  await cycle.getByRole("combobox",{name:"Duração do ciclo de trabalho"}).selectOption("14");
  await cycle.getByLabel("Data de início do ciclo").fill("2026-11-02");
  await cycle.getByRole("button",{name:"Guardar escolha do ciclo"}).click();
  await wait(()=>persisted.accountingCycleDays===14 &&
    persisted.cycleAnchorDate==="2026-11-02","14-day cycle persisted");
  await guide.getByText("0 de 5").waitFor();
  // 28-day choice retains the PR47 accounting boundaries.
  await operation.getByRole("button",{name:"Alterar ciclo"}).click();
  await cycle.getByRole("combobox",{name:"Duração do ciclo de trabalho"}).selectOption("28");
  await cycle.getByRole("button",{name:"Guardar escolha do ciclo"}).click();
  await wait(()=>persisted.accountingCycleDays===28 &&
    persisted.cycleAnchorDate==="2026-11-02","28-day anchor persisted");
  // A fresh document must load exactly the confirmed choice and not create a default.
  await page.goto(origin+"/operacao",{waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  await page.getByRole("button",{name:"Operação",exact:true}).click();
  matches(await operation.getByLabel("Fuso horário IANA").inputValue(),
    "Europe/Lisbon","Timezone must survive reload.");
  await operation.getByText("Ciclo de 28 dias · início 2026-11-02").waitFor();
  assert.equal(persisted.accountingCycleDays,28,"Cycle duration must survive reload.");
  // PR62: compact weekday rows show no advanced editor until explicitly opened.
  const weekly=page.locator(".schedule-table");
  assert.equal(await weekly.locator(".operation-schedule-row").count(),7,
    "All seven weekdays must remain available in the compact weekly table.");
  assert.equal(await weekly.locator(".operation-advanced-row").count(),0,
    "No advanced editor should occupy space by default.");
  assert.match(await page.locator(".operation-mode-hint").innerText(),
    /Funcionamento semanal: contínuo/);
  const monday=weekly.locator(".operation-schedule-row").filter({hasText:"Segunda"});
  const intervalToggle=monday.getByRole("button",
    {name:"Segunda: Adicionar outro intervalo de funcionamento"});
  assert.equal(await intervalToggle.getAttribute("aria-expanded"),"false");
  await intervalToggle.click();
  const advanced=monday.locator(".operation-advanced-row");
  await advanced.waitFor();
  assert.equal(await monday.getByRole("button",
    {name:"Segunda: Ocultar edição de intervalos"}).getAttribute("aria-expanded"),"true");
  await advanced.getByRole("button",{name:/Adicionar outro intervalo/}).click();
  await wait(()=>persisted.weeklyOperatingHours.monday.length===2,
    "Adding a real second interval persists only after the user requests it");
  assert.equal(await advanced.locator(".se-multi-interval-row").count(),2,
    "Both intervals must be editable inside the on-demand editor.");
  await advanced.getByRole("button",
    {name:"Remover período 2 de funcionamento de Segunda"}).click();
  await wait(()=>persisted.weeklyOperatingHours.monday.length===1,
    "Removing experimental second interval restores original opening");
  await advanced.getByRole("button",{name:"Fechar edição"}).click();
  assert.equal(await weekly.locator(".operation-advanced-row").count(),0);
  await page.locator(".save-status.saved").waitFor();
  await page.goto(origin+"/operacao",{waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  assert.equal(await page.locator(".operation-advanced-row").count(),0,
    "A reload must return to compact view without changing operating hours.");
  assert.deepEqual(persisted.weeklyOperatingHours.monday,
    [{start:"09:00",end:"13:00"}],
    "The original Monday interval is preserved after add/remove and reload.");
  
  // PR61: exception drafts must never autosave or create a fabricated closing.
  const special=page.locator(".exceptions-panel");
  await special.getByRole("heading",{name:"Exceções"}).waitFor();
  await page.locator(".save-status.saved").waitFor();
  const beforeDraftSaves=saves;
  await special.getByRole("button",{name:/Adicionar$/}).click();
  await special.getByRole("form",{name:"Nova exceção"}).waitFor();
  await page.locator(".operation-draft-status").getByText("Exceção por guardar").waitFor();
  await special.getByText(/Rascunho por confirmar/).waitFor();
  assert.equal(await page.locator(".save-status.saved").count(),1,
    "Persisted configuration status must remain separate from unsaved exception draft.");
  assert.equal(persisted.exceptions.length,0,
    "Opening a draft cannot create an operational exception.");
  await special.getByRole("button",{name:"Cancelar"}).click();
  assert.equal(await page.locator(".operation-draft-status").count(),0,
    "Cancel must remove the unsaved draft marker.");
  await delay(700);
  assert.equal(saves,beforeDraftSaves,
    "Canceling the exception draft cannot trigger any cloud save.");
  await special.getByRole("button",{name:/Adicionar$/}).click();
  const draft=special.getByRole("form",{name:"Nova exceção"});
  await draft.getByRole("button",{name:"Data da exceção"}).click();
  await page.getByRole("dialog",{name:"Calendário"})
    .getByRole("button",{name:"12",exact:true}).click();
  await draft.getByLabel("Motivo").fill("Dia especial");
  await draft.getByRole("radio",{name:"Aberto com horário especial"}).check();
  await draft.getByLabel("Fecho").selectOption("17:00");
  assert.equal(persisted.exceptions.length,0,
    "Draft changes stay local until explicitly saved.");
  await draft.getByRole("button",{name:"Guardar exceção"}).click();
  await wait(()=>persisted.exceptions.length===1,
    "Confirmed exception persisted through cloud save");
  assert.equal(persisted.exceptions[0].date,"2026-11-12");
  assert.equal(persisted.exceptions[0].reason,"Dia especial");
  assert.deepEqual(persisted.exceptions[0].intervals,[{start:"09:00",end:"17:00"}]);
  await special.getByRole("button",{name:/Adicionar$/}).click();
  const duplicate=special.getByRole("form",{name:"Nova exceção"});
  await duplicate.getByRole("button",{name:"Data da exceção"}).click();
  await page.getByRole("dialog",{name:"Calendário"})
    .getByRole("button",{name:"12",exact:true}).click();
  await duplicate.getByLabel("Motivo").fill("Duplicado");
  await duplicate.getByRole("button",{name:"Guardar exceção"}).click();
  await duplicate.getByRole("alert").getByText(/Já existe uma exceção/).waitFor();
  assert.equal(persisted.exceptions.length,1,"Duplicate rejected without writes.");
  await duplicate.getByRole("button",{name:"Cancelar"}).click();
  await special.getByRole("button",{name:"Editar"}).click();
  const edited=special.getByRole("form",{name:"Editar exceção"});
  await edited.getByLabel("Motivo").fill("Não publicar");
  await edited.getByRole("button",{name:"Cancelar"}).click();
  assert.equal(persisted.exceptions[0].reason,"Dia especial",
    "Canceling an edit must preserve existing data.");
  await special.getByRole("button",{name:"Remover"}).click();
  await special.getByRole("button",{name:"Cancelar"}).click();
  assert.equal(persisted.exceptions.length,1,
    "Canceling removal must preserve original exception.");
  await special.getByRole("button",{name:"Remover"}).click();
  await special.getByRole("button",{name:"Confirmar remoção"}).click();
  await wait(()=>persisted.exceptions.length===0,
    "Explicit removal confirmation persists an empty exception set");
  // PR64: coverage absent in legacy state inherits one-person HARD policy.
  // Confirm the operational checkpoint after changing the accounting cycle.
  await guide.getByRole("button",{name:"Ver etapas"}).click();
  await guide.getByRole("button",{name:"Confirmar funcionamento"}).click();
  await wait(()=>Boolean(persisted.onboarding?.operationConfirmedFingerprint),
    "Operational configuration re-confirmed after cycle change");
  await page.locator(".save-status.saved").waitFor();
  await page.getByRole("button",{name:"Presença mínima",exact:true}).click();
  const presenceUI=page.getByRole("region",{name:"Confirmação de cobertura"});
  await page.getByText("Regra padrão: 1 pessoa durante todo o funcionamento").waitFor();
  const mondayCoverage=page.locator(".presence-compact-day").filter({hasText:"Segunda"});
  assert.equal(await mondayCoverage.getByText("Personalizada").count(),1,
    "Existing customized day must not be silently replaced with default.");
  const coverageSaves=saves;
  await page.getByRole("button",{name:"Configurar vários dias"}).click();
  await page.getByText("Cobertura por guardar").waitFor();
  const bulk=page.getByRole("group",{name:"Configurar cobertura de vários dias"});
  await bulk.getByLabel("Mínimo uniforme de colaboradores").fill("3");
  await bulk.getByRole("button",{name:"Cancelar"}).click();
  await delay(700);
  assert.equal(saves,coverageSaves,
    "Cancelled bulk-coverage draft must trigger no cloud write.");
  assert.equal(persisted.weeklyPresenceRequirements.monday.minimumDuringOperation,1,
    "Cancelled draft cannot overwrite an existing day.");
  await mondayCoverage.getByRole("button",{name:"Editar mínimos"}).click();
  await mondayCoverage.getByLabel("Segunda: Período central").fill("3");
  assert.equal(persisted.weeklyPresenceRequirements.monday.minimumDuringOperation,1,
    "Editing a day must stay in a draft until Save.");
  await mondayCoverage.getByRole("button",{name:"Cancelar"}).click();
  await page.locator(".save-status.saved").waitFor();
  await mondayCoverage.getByRole("button",{name:"Repor padrão"}).click();
  await mondayCoverage.getByRole("button",{name:"Confirmar padrão"}).click();
  await wait(()=>persisted.weeklyPresenceRequirements.monday===null,
    "Explicit reset inherits default rather than saving fake zeros");
  await mondayCoverage.getByText("Mínimo de 1 pessoa em todo o horário").waitFor();
  await page.locator(".save-status.saved").waitFor();
  await presenceUI.getByRole("button",{name:"Confirmar cobertura"}).click();
  await wait(()=>Boolean(persisted.onboarding?.coverageConfirmedFingerprint),
    "Default one-person coverage is explicitly confirmed and persisted");
  await presenceUI.getByText("Etapa 2 confirmada").waitFor();
  await page.goto(origin+"/operacao/cobertura",{waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  await page.getByText("Etapa 2 confirmada").waitFor();
  await mondayCoverage.getByRole("button",{name:"Personalizar"}).click();
  await mondayCoverage.getByLabel("Segunda: Período central").fill("0");
  await mondayCoverage.getByLabel("Segunda: Na abertura").fill("0");
  await mondayCoverage.getByLabel("Segunda: No fecho").fill("0");
  await mondayCoverage.getByRole("button",{name:"Guardar mínimos"}).click();
  await wait(()=>persisted.weeklyPresenceRequirements.monday?.minimumDuringOperation===0,
    "Explicit zero is a conscious saved override of inherited one.");
  await presenceUI.getByRole("button",{name:"Confirmar cobertura"}).waitFor();
  // Restore the synthetic test's original 1 / 1 / 1 rules for other checks.
  await mondayCoverage.getByRole("button",{name:"Editar mínimos"}).click();
  await mondayCoverage.getByLabel("Segunda: Período central").fill("1");
  await mondayCoverage.getByLabel("Segunda: Na abertura").fill("1");
  await mondayCoverage.getByLabel("Segunda: No fecho").fill("1");
  await mondayCoverage.getByRole("button",{name:"Guardar mínimos"}).click();
  await wait(()=>persisted.weeklyPresenceRequirements.monday?.minimumDuringOperation===1,
    "Synthetic weekly coverage restored after explicit-zero test");
  await page.locator(".save-status.saved").waitFor();
  const beforeExceptionDraft=saves;
  await page.getByRole("button",{name:/Adicionar$/}).click();
  await page.getByRole("group",{name:"Editar exceção de cobertura"}).waitFor();
  await page.getByRole("group",{name:"Editar exceção de cobertura"})
    .getByLabel("Data da exceção de cobertura").fill("2026-11-12");
  assert.equal(persisted.presenceExceptions.length,0,
    "A new presence exception draft must not auto-save.");
  await page.getByRole("group",{name:"Editar exceção de cobertura"})
    .getByRole("button",{name:"Cancelar"}).click();
  await delay(700);
  assert.equal(saves,beforeExceptionDraft,
    "Canceling a presence exception must not issue a persistence write");
  assert.equal(persisted.presenceExceptions.length,0);
  await page.getByRole("button",{name:"Horários",exact:true}).click();
  await page.locator('button.se-day[aria-label^="29 de novembro"]')
    .click();
  await page.getByText("2026-11-02 a 2026-11-29 · semana 4/4")
    .waitFor();
  await page.locator('button.se-day[aria-label^="30 de novembro"]')
    .click();
  await page.getByText("2026-11-30 a 2026-12-27 · semana 1/4")
    .waitFor();
  // Daily management v2: quick filters, six filter states, read-only comparison.
  await page.getByRole("button",{name:/Gerir horário deste dia/}).click();
  const management=page.getByRole("region",{name:"Gestão diária"});
  await management.getByRole("heading",{name:"Colaboradores"}).waitFor();
  assert.equal(await management.locator(".se-daily-compact-stats > div").count(),5,
    "Five daily status metrics stay visible.");
  assert.equal(await management.locator(".se-pagination").count(),0,
    "No meaningless pagination for a single person.");
  const quick=management.getByRole("group",{name:"Filtros rápidos"});
  await quick.getByRole("button",{name:"Escalados"}).click();
  await management.getByText("Nenhuma pessoa corresponde a este filtro.").waitFor();
  await quick.getByRole("button",{name:"Toda a equipa"}).click();
  assert.equal(await management.locator(".se-daily-roster-row").count(),1);
  const extra=management.getByRole("combobox",{name:"Mais filtros"});
  assert.deepEqual(await extra.locator("option").allTextContents(),
    ["Mais filtros","Por planear / sem escala","Selecionados"]);
  await extra.selectOption("unplanned");
  assert.equal(await management.locator(".se-daily-roster-row").count(),1,
    "Unplanned remains explicit, not automatically day off.");
  await management.locator(".se-daily-roster-row input[type=checkbox]").check();
  await management.getByRole("button",{name:"Comparar horários"}).click();
  const comparison=management.getByRole("region",{name:"Comparação de colaboradores"});
  await comparison.getByText("Colaborador de Ensaio").waitFor();
  assert.equal(await comparison.locator(".se-daily-comparison-card").count(),1);
  assert.match(await comparison.innerText(),/Não altera turnos, disponibilidades ou registos oficiais/);
  await management.getByRole("button",{name:"Fechar comparação"}).click();
  await management.getByRole("button",{name:"← Calendário mensal"}).click();
  await page.getByRole("heading",{name:"Calendário mensal"}).waitFor();
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
  // The settings deep link must recover persisted policies on direct entry.
  await page.goto(origin+"/regras",{waitUntil:"domcontentloaded"});
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
  // PR65: new collaborators must not enter cloud state until an explicit Save.
  const beforePeopleWrites=saves;
  await page.getByRole("button",{name:"+ Adicionar colaborador"}).click();
  const newStaff=page.getByRole("form",{name:"Novo colaborador"});
  await newStaff.getByLabel("Nome do colaborador").fill("Pessoa Experimental");
  await newStaff.getByRole("button",{name:"Guardar colaborador"}).click();
  await newStaff.getByRole("alert").getByText(/Escolhe como este colaborador/).waitFor();
  await newStaff.getByRole("radio",{name:"Apenas em períodos definidos"}).check();
  await newStaff.getByLabel("Data de início do vínculo").fill("2026-11-01");
  await newStaff.getByLabel("Data de fim do vínculo").fill("2026-11-30");
  await newStaff.getByRole("button",{name:"Adicionar período ao rascunho"}).click();
  assert.equal(persisted.people.length,1,
    "Creating a dated person must remain local until Save.");
  await newStaff.getByRole("button",{name:"Cancelar"}).click();
  await delay(700);
  assert.equal(saves,beforePeopleWrites,
    "Canceling new person with multiple draft edits must not write to cloud.");
  assert.equal(persisted.people.length,1,
    "Canceled person never creates a default availability record.");

  const firstPerson=page.locator(".team-person-record").filter({hasText:personName});
  await firstPerson.getByRole("button",{name:"Editar"}).click();
  const editing=page.getByRole("form",{name:"Editar colaborador "+personName});
  await editing.getByLabel("Nome do colaborador").fill("Nome temporário");
  await editing.getByRole("radio",{name:"Apenas em períodos definidos"}).check();
  await editing.getByLabel("Data de início do vínculo").fill("2026-11-01");
  await editing.getByRole("button",{name:"Adicionar período ao rascunho"}).click();
  assert.equal(persisted.people[0].employmentPeriods,undefined,
    "Draft employment periods must not update stored legacy eligibility.");
  await editing.getByRole("button",{name:"Cancelar"}).click();
  await delay(700);
  assert.equal(saves,beforePeopleWrites,
    "Canceling existing person edits must not write anything.");
  assert.equal(persisted.people[0].name,personName,
    "Cancel must preserve the original name and employment periods.");

  await page.getByRole("button",{name:"+ Adicionar colaborador"}).click();
  const created=page.getByRole("form",{name:"Novo colaborador"});
  await created.getByLabel("Nome do colaborador").fill("Pessoa de Ensaio Dois");
  await created.getByRole("radio",{name:"Apenas em períodos definidos"}).check();
  await created.getByLabel("Data de início do vínculo").fill("2026-11-01");
  await created.getByLabel("Data de fim do vínculo").fill("2026-11-30");
  await created.getByRole("button",{name:"Adicionar período ao rascunho"}).click();
  await created.getByLabel("Máximo contratual da pessoa").fill("20");
  await created.getByLabel("Objetivo semanal da pessoa").fill("15");
  await created.getByLabel("Qualificações da pessoa").fill("Receção, Caixa");
  await created.getByRole("button",{name:"Guardar colaborador"}).click();
  await wait(()=>persisted.people.length===2,
    "One explicit save creates the person and persistent availability.");
  assert.equal(persisted.people[1].weeklyContractMinutes,1200);
  assert.equal(persisted.people[1].weeklyTargetMinutes,900);
  assert.deepEqual(persisted.people[1].qualificationTags,["Receção","Caixa"]);
  await page.locator(".save-status.saved").waitFor();
  const teamStep=page.getByRole("region",{name:"Confirmação da equipa"});
  await teamStep.getByRole("button",{name:"Confirmar equipa"}).click();
  await wait(()=>Boolean(persisted.onboarding?.teamConfirmedFingerprint),
    "Team confirmation fingerprint was persisted.");
  await teamStep.getByText("Etapa 3 confirmada").waitFor();
  await page.goto(origin+"/equipa",{waitUntil:"domcontentloaded"});
  await page.locator(".save-status.saved").waitFor();
  await teamStep.getByText("Etapa 3 confirmada").waitFor();
  const second=page.locator(".team-person-record").filter({hasText:"Pessoa de Ensaio Dois"});
  await second.getByRole("button",{name:"Editar"}).click();
  const secondDraft=page.getByRole("form",{name:"Editar colaborador Pessoa de Ensaio Dois"});
  await secondDraft.getByLabel("Nome do colaborador").fill("Pessoa de Ensaio Atualizada");
  await secondDraft.getByRole("button",{name:"Guardar colaborador"}).click();
  await wait(()=>persisted.people[1].name==="Pessoa de Ensaio Atualizada",
    "Saving a change to the team persists it.");
  await teamStep.getByRole("button",{name:"Confirmar equipa"}).waitFor();
  await page.locator(".save-status.saved").waitFor();
  const updated=page.locator(".team-person-record").filter({hasText:"Pessoa de Ensaio Atualizada"});
  await updated.getByRole("button",{name:"Arquivar"}).click();
  assert.equal(persisted.people[1].active,true,
    "Archiving must require explicit confirmation.");
  await updated.getByRole("button",{name:"Confirmar",exact:true}).click();
  await wait(()=>persisted.people[1].active===false,
    "Archive was confirmed and saved.");
  await page.locator(".save-status.saved").waitFor();
  await teamStep.getByRole("button",{name:"Confirmar equipa"}).click();
  await wait(()=>Boolean(persisted.onboarding?.teamConfirmedFingerprint),
    "Reconfirmation of archived team persisted.");
  await page.getByRole("button",{name:"Operação",exact:true}).click();
  const guided=page.getByRole("region",{name:"Configuração inicial guiada"});
  await guided.getByText("3 de 5").waitFor();
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
  await page.getByRole("button",{name:"Alterar ciclo"}).click();
  const refused=page.getByRole("group",{name:"Escolher ciclo de trabalho"});
  await refused.getByLabel("Data de início do ciclo").fill("2026-11-09");
  await refused.getByRole("button",{name:"Guardar escolha do ciclo"}).click();
  await page.getByRole("heading",{name:"Não foi possível carregar a configuração"})
    .waitFor({timeout:10000});
  await page.getByRole("button",{
    name:"Descarregar cópia das alterações pendentes (JSON)",
  }).waitFor();
  matches(persisted.cycleAnchorDate,"2026-11-02",
    "Unacknowledged write must not replace the server baseline.");
  assert(saves>=4,"Real UI must have persisted multiple independent changes.");
  // PR60: browser-addressable application pages, including deep-linked days.
  // Isolate history tests in a separate tab: WebKit Linux BFCache can crash
  // on unrelated later reloads after a back-forward traversal.
  const routePage=await context.newPage();
  await routePage.goto(origin,{waitUntil:"domcontentloaded"});
  await routePage.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  await routePage.getByRole("button",{name:"Equipa",exact:true}).click();
  await routePage.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  assert.equal(new URL(routePage.url()).pathname,"/equipa",
    "A workspace navigation action must update the browser URL.");
  await routePage.goBack();
  await routePage.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  assert.equal(new URL(routePage.url()).pathname,"/horarios",
    "Browser Back must restore the calendar.");
  await routePage.goForward();
  await routePage.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  await routePage.close();

  const deepPage=await context.newPage();
  await deepPage.goto(origin+"/equipa",{waitUntil:"domcontentloaded"});
  await deepPage.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  await deepPage.reload({waitUntil:"domcontentloaded"});
  await deepPage.getByRole("heading",{name:"Pessoas",exact:true}).waitFor();
  assert.equal(new URL(deepPage.url()).pathname,"/equipa",
    "Reloading a nested workspace URL must preserve the same view.");
  await deepPage.goto(origin+"/horarios/2026-11-09",{waitUntil:"domcontentloaded"});
  await deepPage.getByRole("region",{name:"Gestão diária"}).waitFor();
  assert.equal(new URL(deepPage.url()).pathname,"/horarios/2026-11-09");
  await deepPage.reload({waitUntil:"domcontentloaded"});
  await deepPage.getByRole("region",{name:"Gestão diária"}).waitFor();
  await deepPage.getByRole("button",{name:"← Calendário mensal"}).click();
  await deepPage.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  assert.equal(new URL(deepPage.url()).pathname,"/horarios",
    "Returning from a dated page must produce the canonical calendar URL.");
  await deepPage.goBack();
  await deepPage.getByRole("region",{name:"Gestão diária"}).waitFor();
  await deepPage.goForward();
  await deepPage.getByRole("heading",{name:"Calendário mensal"}).waitFor();
  await deepPage.close();

  assert.equal(errors.length,0,"No browser errors: "+errors.join("; "));
  console.log("PR47 WebKit: 01 documentation limit, 14 failed write warning, 15 persisted zone, 18 29/30 cycle, 19 person policy persistence, 21 retired UI, 22 terminology PASS (synthetic backend).");
}finally{
  if(browser)await browser.close();
  server.kill("SIGTERM");
  if(serverOutput&&process.env.PR47_DEBUG_WEBKIT)console.log(serverOutput);
}
