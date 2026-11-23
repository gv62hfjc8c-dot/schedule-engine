import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  createPrivateAssetHandler,
  type PrivateEnvironment,
} from "../src/cloudflare/privateWorker";

const issuer="https://schedule-engine-test.cloudflareaccess.com";
const audience="a73b2d55007abecd7890000000000000";
const email="private-owner@example.invalid";
const now=()=>Math.floor(Date.now()/1000);

interface Fixture {
  key:CryptoKey;
  jwk:JsonWebKey;
}
let fixturePromise:Promise<Fixture>|undefined;
function keys():Promise<Fixture>{
  if(!fixturePromise){
    fixturePromise=(async()=>{
      const pair=await crypto.subtle.generateKey({
        name:"RSASSA-PKCS1-v1_5",
        modulusLength:2048,
        publicExponent:new Uint8Array([1,0,1]),
        hash:"SHA-256",
      },true,["sign","verify"]) as CryptoKeyPair;
      return {key:pair.privateKey,
        jwk:await crypto.subtle.exportKey("jwk",pair.publicKey)};
    })();
  }
  return fixturePromise;
}
function encode(value:object):string{
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
async function token(
  changes:Record<string,unknown>={},
  headerChanges:Record<string,unknown>={},
):Promise<string>{
  const {key}=await keys();
  const protectedHeader=encode({alg:"RS256",typ:"JWT",kid:"test-key",
    ...headerChanges});
  const claims=encode({
    iss:issuer,aud:[audience],email,
    iat:now()-20,nbf:now()-20,exp:now()+1800,
    ...changes,
  });
  const signed=protectedHeader+"."+claims;
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
    key,new TextEncoder().encode(signed));
  return signed+"."+Buffer.from(signature).toString("base64url");
}
function env():PrivateEnvironment{
  return {
    ACCESS_TEAM_DOMAIN:issuer,
    ACCESS_APPLICATION_AUD:audience,
    ACCESS_OWNER_EMAIL:email,
    ASSETS:{fetch:async request=>
      new Response("private asset "+new URL(request.url).pathname,{
        status:200,headers:{"content-type":"text/plain",
          "cache-control":"public, max-age=31536000",
          "access-control-allow-origin":"*"},
      })},
  };
}
async function handler(){
  const {jwk}=await keys();
  const urls:string[]=[];
  const serve=createPrivateAssetHandler(async url=>{
    urls.push(url);
    return {keys:[{kty:"RSA",kid:"test-key",alg:"RS256",use:"sig",
      n:jwk.n,e:jwk.e}]};
  });
  return {serve,urls};
}
function req(path:string,assertion?:string,method="GET"){
  return new Request("https://private.example.test"+path,{
    method,headers:assertion?{"Cf-Access-Jwt-Assertion":assertion}:undefined,
  });
}
test("PR98: ausência de configuração recusa TODOS os recursos",async()=>{
  const {serve,urls}=await handler();
  const settings=env();
  delete settings.ACCESS_TEAM_DOMAIN;
  for(const path of ["/","/horarios","/configuracao","/assets/app.js","/index.html"]){
    assert.equal((await serve(req(path,await token()),settings)).status,503);
  }
  assert.deepEqual(urls,[]);
});
test("PR98: JWT em falta recusa HTML, CSS, JS e qualquer API",async()=>{
  const {serve,urls}=await handler();
  for(const path of ["/","/horarios","/assets/style.css","/assets/app.js",
    "/api/private-data"]){
    const result=await serve(req(path),env());
    assert.equal(result.status,403);
    assert.equal(result.headers.get("cache-control"),"no-store");
  }
  assert.deepEqual(urls,[]);
});
test("PR98: apenas token autenticado e email autorizado servem assets",async()=>{
  const {serve,urls}=await handler();
  const valid=await token();
  const first=await serve(req("/horarios",valid),env());
  assert.equal(first.status,200);
  assert.equal(await first.text(),"private asset /horarios");
  assert.equal(first.headers.get("cache-control"),"private, no-store");
  assert.equal(first.headers.get("x-robots-tag"),"noindex, nofollow");
  assert.equal(first.headers.get("x-frame-options"),"DENY");
  assert.equal(first.headers.get("access-control-allow-origin"),null);
  assert.equal((await serve(req("/assets/private.css",valid),env())).status,200);
  assert.deepEqual(urls,[issuer+"/cdn-cgi/access/certs"],
    "chaves públicas podem ser reutilizadas por cinco minutos");
});
test("PR98: root autenticada salta login falso, sem alterar localStorage",async()=>{
  const {serve}=await handler();
  const result=await serve(req("/",await token()),env());
  assert.equal(result.status,302);
  assert.equal(result.headers.get("location"),"/horarios");
  assert.equal(result.headers.get("cache-control"),"no-store");
});
test("PR98: outro email é proibido, mesmo com assinatura válida",async()=>{
  const {serve}=await handler();
  for(const invalid of ["stranger@example.invalid",
    "private-owner+other@example.invalid"]){
    assert.equal((await serve(req("/horarios",
      await token({email:invalid})),env())).status,403);
  }
  assert.equal((await serve(req("/horarios",
    await token({email:email.toUpperCase()})),env())).status,200);
});
test("PR98: assinatura, emissor, audience e expiração são obrigatórios",async()=>{
  const {serve}=await handler();
  for(const claims of [
    {iss:"https://fake.cloudflareaccess.com"},
    {aud:["another-access-application"]},
    {exp:now()-1},
    {nbf:now()+100},
    {iat:now()+3600},
    {email:null},
    {exp:undefined},
    {aud:undefined},
  ]){
    const status=(await serve(req("/horarios",await token(claims)),env())).status;
    assert.equal(status,403,JSON.stringify(claims));
  }
  const legitimate=await token();
  const altered=legitimate.split(".");
  altered[1]=encode({iss:issuer,aud:[audience],email:"attacker@example.invalid",
    exp:now()+300});
  assert.equal((await serve(req("/horarios",altered.join(".")),env())).status,403);
});
test("PR98: tokens malformados, sem RS256 e sem chave pública falham",async()=>{
  const {serve}=await handler();
  for(const value of ["nonsense","a.b.c","x".repeat(8200),"",
    await token({}, {alg:"none"}),await token({}, {kid:"unknown"})]){
    const result=await serve(req("/horarios",value),env());
    assert.equal(result.status,403);
  }
  const failed=createPrivateAssetHandler(async()=>({keys:[]}));
  assert.equal((await failed(req("/horarios",await token()),env())).status,403);
  const unavailable=createPrivateAssetHandler(async()=>{throw Error("network");});
  assert.equal((await unavailable(req("/horarios",await token()),env())).status,403);
});
test("PR98: domínio Access não pode ser alterado para um host arbitrário",async()=>{
  const {serve,urls}=await handler();
  const setting=env();
  setting.ACCESS_TEAM_DOMAIN="https://malicious.example.com";
  assert.equal((await serve(req("/horarios",await token()),setting)).status,503);
  setting.ACCESS_TEAM_DOMAIN=issuer+"/wrong/path";
  assert.equal((await serve(req("/horarios",await token()),setting)).status,503);
  assert.deepEqual(urls,[]);
});
test("PR98: escrita é negada após verificação, sem confiar na UI",async()=>{
  const {serve}=await handler();
  const result=await serve(req("/api/changes",await token(),"POST"),env());
  assert.equal(result.status,405);
  assert.equal(result.headers.get("cache-control"),"no-store");
});
test("PR98: Cloudflare sem roteamento público e sem bypass de assets",()=>{
  const config=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
  const uncommented=config.replace(/^\s*\/\/.*$/gm,"");
  const wrangler=JSON.parse(uncommented) as {
    workers_dev:boolean;
    preview_urls:boolean;
    assets:{run_worker_first:boolean;binding:string;directory:string;
      not_found_handling:string};
  };
  assert.equal(wrangler.workers_dev,false);
  assert.equal(wrangler.preview_urls,false);
  assert.equal(wrangler.assets.run_worker_first,true);
  assert.equal(wrangler.assets.binding,"ASSETS");
  assert.equal(wrangler.assets.directory,"./dist");
  assert.equal(wrangler.assets.not_found_handling,"single-page-application");
  assert.doesNotMatch(config,/"(routes?|vars|account_id)"\s*:/);
  const ignored=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");
  assert.match(ignored,/\.dev\.vars/);
  assert.match(ignored,/\.wrangler\//);
});
