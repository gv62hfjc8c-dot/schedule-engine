/**
 * Read-only, two-account live RLS acceptance check.
 *
 * Requires two explicit disposable accounts on the SAME staging project,
 * each with at least one configuration row and generated proposal.
 * This script does NOT register users, insert rows or change policies.
 * Never use a service role/secret key. Never print passwords or JWTs.
 *
 * Execute locally after setting the environment variables documented in
 * docs/pr47-acceptance.md. Do not include this in ordinary CI.
 */
const required=[
  "RLS_TEST_SUPABASE_URL","RLS_TEST_PUBLISHABLE_KEY",
  "RLS_TEST_EMAIL_A","RLS_TEST_PASSWORD_A",
  "RLS_TEST_EMAIL_B","RLS_TEST_PASSWORD_B",
];
const missing=required.filter(k=>!process.env[k]);
if(missing.length){
  console.error("Faltam variáveis de ambiente: "+missing.join(", "));
  process.exit(2);
}
if(process.env.RLS_TEST_CONFIRM!=="STAGING_ONLY"){
  console.error("Confirma o ambiente isolado com RLS_TEST_CONFIRM=STAGING_ONLY.");
  process.exit(2);
}
const url=new URL(process.env.RLS_TEST_SUPABASE_URL);
if(url.protocol!=="https:"||!url.hostname.endsWith(".supabase.co")){
  console.error("O endereço tem de ser HTTPS num projeto Supabase.");
  process.exit(2);
}
const apiKey=process.env.RLS_TEST_PUBLISHABLE_KEY;
if(!apiKey.startsWith("sb_publishable_")){
  console.error("Este teste requer apenas a chave publishable, nunca secret/service_role.");
  process.exit(2);
}
if(process.env.RLS_TEST_EMAIL_A===process.env.RLS_TEST_EMAIL_B){
  console.error("São necessárias duas contas distintas.");
  process.exit(2);
}

async function signIn(email,password){
  const response=await fetch(url.origin+"/auth/v1/token?grant_type=password",{
    method:"POST",headers:{
      apikey:apiKey,"Content-Type":"application/json",
    },body:JSON.stringify({email,password}),cache:"no-store",
  });
  if(!response.ok)throw Error("Falha de autenticação de uma conta de teste ("+response.status+").");
  const body=await response.json();
  if(typeof body.access_token!=="string"||typeof body.user?.id!=="string")
    throw Error("Sessão de teste incompleta.");
  return {token:body.access_token,id:body.user.id};
}
async function read(token,table,params){
  const request=new URL(url.origin+"/rest/v1/"+table);
  request.searchParams.set("select","owner_id");
  request.searchParams.set("limit","3");
  if(params?.owner)request.searchParams.set("owner_id","eq."+params.owner);
  const response=await fetch(request,{
    headers:{apikey:apiKey,Authorization:"Bearer "+token,
      Accept:"application/json"},
    cache:"no-store",
  });
  if(!response.ok)throw Error("A consulta RLS de "+table+" falhou com HTTP "+response.status+".");
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.some(r=>typeof r.owner_id!=="string"))
    throw Error("Resposta incompatível na tabela "+table+".");
  return rows;
}

try {
  const [a,b]=await Promise.all([
    signIn(process.env.RLS_TEST_EMAIL_A,process.env.RLS_TEST_PASSWORD_A),
    signIn(process.env.RLS_TEST_EMAIL_B,process.env.RLS_TEST_PASSWORD_B),
  ]);
  if(a.id===b.id)throw Error("As duas contas autenticaram com o mesmo ID.");
  let checked=0;
  const tables=[
    "schedule_engine_states",
    "schedule_engine_state_history",
    "schedule_engine_generated_schedules",
  ];
  for(const table of tables){
    const [mineA,mineB,bGetsA,aGetsB,allA,allB]=await Promise.all([
      read(a.token,table,{owner:a.id}),read(b.token,table,{owner:b.id}),
      read(b.token,table,{owner:a.id}),read(a.token,table,{owner:b.id}),
      read(a.token,table),read(b.token,table),
    ]);
    if(!mineA.length||!mineB.length){
      console.log("BLOCKED "+table+": criar primeiro dados próprios nas duas contas de ensaio.");
      continue;
    }
    if(bGetsA.length||aGetsB.length||
      allA.some(r=>r.owner_id!==a.id)||
      allB.some(r=>r.owner_id!==b.id))
      throw Error("FALHA P0: isolamento RLS insuficiente em "+table+".");
    console.log("PASS "+table+": isolamento bidirecional verificado com dados das duas contas.");
    checked++;
  }
  if(checked!==tables.length){
    console.error("Não considerar RLS aprovado até ambas as contas terem registos em todas as tabelas.");
    process.exitCode=2;
  }else{
    console.log("PASS: 3 tabelas do fluxo ativo isoladas entre duas contas reais de staging.");
  }
}catch(error){
  console.error(error instanceof Error?error.message:"Falha no ensaio de isolamento.");
  process.exitCode=1;
}
