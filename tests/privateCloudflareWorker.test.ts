import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createPrivateAssetHandler,type PrivateEnvironment} from
  "../src/cloudflare/privateWorker";

const origin="https://schedule-engine-private.sample.workers.dev";
const clientId="Ov23li01234567890123";
const ownerId=12345678;
const key=Buffer.alloc(32,17).toString("base64url");
const now=()=>Math.floor(Date.now()/1000);
function env():PrivateEnvironment{
  return {
    PUBLIC_ORIGIN:origin,
    GITHUB_CLIENT_ID:clientId,
    GITHUB_CLIENT_SECRET:"secret-github-oauth-application-value",
    GITHUB_ALLOWED_USER_ID:String(ownerId),
    SESSION_SECRET:key,
    ASSETS:{fetch:async request=>new Response(
      "PROTECTED APP "+new URL(request.url).pathname,
      {headers:{
        "content-type":"text/plain",
        "cache-control":"public, max-age=3600",
        "access-control-allow-origin":"*",
      }},
    )},
  };
}
function req(path:string,cookie?:string,method="GET",extras?:HeadersInit){
  return new Request(origin+path,{method,headers:{
    ...(cookie?{cookie}:{}),...extras,
  }});
}
function cookieValue(response:Response,name:string):string{
  const source=response.headers.get("set-cookie")??"";
  const found=source.match(new RegExp(name+"=([^;, ]+)"));
  if(!found)throw Error("Missing "+name+" Set-Cookie: "+source);
  return found[1];
}
function fakeGitHub(profileId:unknown=ownerId){
  const logs:{url:string;init:RequestInit}[]=[];
  const client=async(url:string,init:RequestInit)=>{
    logs.push({url,init});
    if(url==="https://github.com/login/oauth/access_token"){
      return Response.json({access_token:"valid-internal-github-token"});
    }
    if(url==="https://api.github.com/user"){
      return Response.json({id:profileId,login:"user"});
    }
    throw Error("Unexpected outbound request "+url);
  };
  return {client,logs};
}
async function oauthStart(serve:ReturnType<typeof createPrivateAssetHandler>){
  const start=await serve(req("/auth/start"),env());
  assert.equal(start.status,302);
  const github=new URL(start.headers.get("location")!);
  const csrfCookie=cookieValue(start,"__Host-se-oauth");
  return {start,github,csrfCookie,state:github.searchParams.get("state")!};
}
async function successfulLogin(
  serve:ReturnType<typeof createPrivateAssetHandler>,
){
  const auth=await oauthStart(serve);
  const reply=await serve(req("/auth/callback?code=approved123&state="+auth.state,
    "__Host-se-oauth="+auth.csrfCookie),env());
  assert.equal(reply.status,302);
  return {session:cookieValue(reply,"__Host-se-session"),reply,auth};
}
test("PR98 B: configuração ausente falha fechada em todas as rotas",async()=>{
  const serve=createPrivateAssetHandler();
  const cfg=env();delete cfg.SESSION_SECRET;
  for(const path of ["/","/horarios","/assets/app.js","/auth/start",
    "/auth/callback?code=1&state=2","/api/private"]){
    assert.equal((await serve(req(path),cfg)).status,503,path);
  }
  cfg.SESSION_SECRET="weak";
  assert.equal((await serve(req("/"),cfg)).status,503);
  cfg.SESSION_SECRET=key;
  cfg.GITHUB_ALLOWED_USER_ID="0";
  assert.equal((await serve(req("/"),cfg)).status,503);
});
test("PR98 B: login público não expõe app nem ficheiros sem sessão",async()=>{
  const serve=createPrivateAssetHandler();
  const entry=await serve(req("/"),env());
  assert.equal(entry.status,200);
  const text=await entry.text();
  assert.match(text,/Entrar com GitHub/);
  assert.doesNotMatch(text,/PROTECTED APP/);
  assert.equal(entry.headers.get("cache-control"),"private, no-store");
  assert.equal(entry.headers.get("x-robots-tag"),"noindex, nofollow");
  for(const path of ["/horarios","/configuracao","/assets/index.js",
    "/index.html","/favicon.ico","/api/config"]){
    const response=await serve(req(path),env());
    assert.equal(response.status,401,path);
    assert.doesNotMatch(await response.text(),/PROTECTED APP/);
  }
});
test("PR98 B: OAuth com state assinado e PKCE sem scopes intrusivos",async()=>{
  const serve=createPrivateAssetHandler();
  const {start,github,csrfCookie,state}=await oauthStart(serve);
  assert.equal(github.origin,"https://github.com");
  assert.equal(github.pathname,"/login/oauth/authorize");
  assert.equal(github.searchParams.get("client_id"),clientId);
  assert.equal(github.searchParams.get("redirect_uri"),origin+"/auth/callback");
  assert.equal(github.searchParams.get("scope"),"");
  assert.equal(github.searchParams.get("state"),state);
  assert.equal(github.searchParams.get("code_challenge_method"),"S256");
  assert.ok((github.searchParams.get("code_challenge")??"").length>=43);
  const header=start.headers.get("set-cookie")??"";
  assert.match(header,/Secure/);
  assert.match(header,/HttpOnly/);
  assert.match(header,/SameSite=Lax/);
  assert.ok(csrfCookie.includes("."));
});
test("PR98 B: só o identificador numérico autorizado recebe sessão",async()=>{
  const {client,logs}=fakeGitHub();
  const serve=createPrivateAssetHandler(client);
  const {session,reply,auth}=await successfulLogin(serve);
  assert.equal(reply.headers.get("location"),"/horarios");
  assert.match(reply.headers.get("set-cookie")??"",/Max-Age=28800/);
  assert.equal(logs.length,2);
  assert.equal(logs[0].url,"https://github.com/login/oauth/access_token");
  assert.equal(logs[0].init.method,"POST");
  const exchanged=new URLSearchParams(String(logs[0].init.body));
  assert.equal(exchanged.get("redirect_uri"),origin+"/auth/callback");
  assert.equal(exchanged.get("client_id"),clientId);
  assert.ok((exchanged.get("code_verifier")??"").length>=43);
  assert.equal(logs[1].url,"https://api.github.com/user");
  assert.match(JSON.stringify(logs[1].init.headers),/Bearer valid-internal/);
  const cookie="__Host-se-session="+session;
  const page=await serve(req("/horarios",cookie),env());
  assert.equal(page.status,200);
  assert.equal(await page.text(),"PROTECTED APP /horarios");
  assert.equal(page.headers.get("cache-control"),"private, no-store");
  assert.equal(page.headers.get("access-control-allow-origin"),null);
  assert.equal(page.headers.get("x-frame-options"),"DENY");
  assert.equal((await serve(req("/assets/app.js",cookie),env())).status,200);
  assert.equal((await serve(req("/",cookie),env())).headers.get("location"),"/horarios");
  assert.ok(!session.includes("valid-internal-github-token"));
  assert.ok(!session.includes(exchanged.get("code_verifier")!));
  // The callback cookies are cleared and session is bound to origin.
  const wrongOrigin=new Request("https://forged.example/horarios",{
    headers:{cookie},
  });
  assert.equal((await serve(wrongOrigin,env())).status,403);
  assert.ok(auth.state);
});
test("PR98 B: outra conta GitHub autenticada é recusada",async()=>{
  for(const fake of [ownerId+1,"12345678",null,0]){
    const {client}=fakeGitHub(fake);
    const serve=createPrivateAssetHandler(client);
    const {state,csrfCookie}=await oauthStart(serve);
    const response=await serve(req("/auth/callback?code=ok&state="+state,
      "__Host-se-oauth="+csrfCookie),env());
    assert.equal(response.status,403,JSON.stringify(fake));
    assert.doesNotMatch(response.headers.get("set-cookie")??"",
      /__Host-se-session=/);
  }
});
test("PR98 B: callback sem cookie, CSRF errado ou manipulado é recusado",async()=>{
  const {client,logs}=fakeGitHub();
  const serve=createPrivateAssetHandler(client);
  const {state,csrfCookie}=await oauthStart(serve);
  for(const cookie of [undefined,
    "__Host-se-oauth="+csrfCookie.slice(0,-1)+"a",
    "__Host-se-oauth=malformed",
  ]){
    const result=await serve(req("/auth/callback?code=ok&state="+state,cookie),
      env());
    assert.equal(result.status,403);
  }
  const incorrect=await serve(req("/auth/callback?code=ok&state=wrong",
    "__Host-se-oauth="+csrfCookie),env());
  assert.equal(incorrect.status,403);
  assert.equal(logs.length,0,
    "no GitHub token exchange before full CSRF verification");
});
test("PR98 B: sessões falsificadas, fracas ou expiradas nunca dão assets",async()=>{
  const {client}=fakeGitHub();
  const serve=createPrivateAssetHandler(client);
  const {session}=await successfulLogin(serve);
  const split=session.split(".");
  const forged=Buffer.from(JSON.stringify({
    sub:ownerId+1,issued:now(),expires:now()+28800,
  })).toString("base64url")+"."+split[1];
  // A distinct signature byte is changed. Changing only the FINAL
  // base64url character could alter unused pad bits but not decoded bytes.
  for(const cookie of [undefined,
    "__Host-se-session=foobar",
    "__Host-se-session="+forged,
    "__Host-se-session="+session.split(".")[0]+"."+
      (split[1][0]==="A"?"B":"A")+split[1].slice(1),
  ]){
    assert.equal((await serve(req("/assets/app.js",cookie),env())).status,401);
  }
  const changed=env();changed.SESSION_SECRET=Buffer.alloc(32,18)
    .toString("base64url");
  assert.equal((await serve(req("/horarios",
    "__Host-se-session="+session),changed)).status,401);
});
test("PR98 B: erro do GitHub ou APIs externas falham sem fallback público",async()=>{
  for(const client of [
    async()=>new Response("unavailable",{status:503}),
    async()=>Response.json({error:"bad_verification_code"}),
    async()=>{throw Error("offline");},
  ]){
    const serve=createPrivateAssetHandler(client);
    const {state,csrfCookie}=await oauthStart(serve);
    const result=await serve(req("/auth/callback?code=ok&state="+state,
      "__Host-se-oauth="+csrfCookie),env());
    assert.equal(result.status,502);
  }
});
test("PR98 B: logout POST requer origem e apaga a sessão",async()=>{
  const {client}=fakeGitHub();
  const serve=createPrivateAssetHandler(client);
  const {session}=await successfulLogin(serve);
  const cookie="__Host-se-session="+session;
  assert.equal((await serve(req("/auth/logout",cookie,"POST"),env())).status,403);
  assert.equal((await serve(req("/auth/logout",cookie,"POST",
    {origin:"https://evil.example"}),env())).status,403);
  const result=await serve(req("/auth/logout",cookie,"POST",
    {origin}),env());
  assert.equal(result.status,302);
  assert.equal(result.headers.get("location"),"/");
  assert.match(result.headers.get("set-cookie")??"",/Max-Age=0/);
});
test("PR98 B: não permite API nem pedidos POST ao motor",async()=>{
  const {client}=fakeGitHub();
  const serve=createPrivateAssetHandler(client);
  const {session}=await successfulLogin(serve);
  const cookie="__Host-se-session="+session;
  assert.equal((await serve(req("/api/private",cookie),env())).status,404);
  assert.equal((await serve(req("/api/private",cookie,"POST"),env())).status,405);
  assert.equal((await serve(req("/auth/start",cookie,"POST"),env())).status,405);
});
test("PR98 B: configuração apenas Workers Free, sem Access e sem bypass",()=>{
  const raw=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
  const parsed=JSON.parse(raw.replace(/^\s*\/\/.*$/gm,"")) as {
    workers_dev:boolean;preview_urls:boolean;
    assets:{run_worker_first:boolean;binding:string;directory:string};
  };
  assert.equal(parsed.workers_dev,true);
  assert.equal(parsed.preview_urls,false);
  assert.equal(parsed.assets.run_worker_first,true);
  assert.equal(parsed.assets.binding,"ASSETS");
  assert.equal(parsed.assets.directory,"./dist");
  assert.doesNotMatch(raw,/"(routes?|vars|account_id)"\s*:/);
  assert.doesNotMatch(raw,/cloudflareaccess\.com|ACCESS_OWNER_EMAIL/);
  const ignored=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");
  assert.match(ignored,/\.dev\.vars/);
  assert.match(ignored,/\.wrangler\//);
});
