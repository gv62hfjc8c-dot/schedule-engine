/**
 * PR98 — Zero-billing private deployment: Cloudflare Workers Free + GitHub OAuth.
 *
 * Every request for HTML/JS/CSS/images enters this Worker first.  Before
 * authentication, no application asset or data can be fetched.  The only
 * permitted account is an immutable, numeric GitHub user ID.  GitHub tokens
 * are used solely during OAuth and are never put into cookies or responses.
 *
 * No Cloudflare Zero Trust, Access, KV, D1, or paid services. Missing
 * configuration FAILS CLOSED.
 */
export interface PrivateEnvironment {
  ASSETS:{fetch(request:Request):Promise<Response>};
  GITHUB_CLIENT_ID?:string;
  GITHUB_CLIENT_SECRET?:string;
  GITHUB_ALLOWED_USER_ID?:string;
  SESSION_SECRET?:string;
  PUBLIC_ORIGIN?:string;
}
type HttpFetcher=(url:string,init:RequestInit)=>Promise<Response>;
interface Config {
  clientId:string;
  clientSecret:string;
  allowedId:number;
  origin:string;
  secret:Uint8Array;
}
interface OAuthState {
  nonce:string;
  verifier:string;
  issued:number;
}
interface Session {
  sub:number;
  issued:number;
  expires:number;
}
const encoder=new TextEncoder();
const COOKIE_SESSION="__Host-se-session";
const COOKIE_STATE="__Host-se-oauth";
const SESSION_SECONDS=8*3600;
const STATE_SECONDS=10*60;
const MAX_COOKIE_SIZE=4096;
const HEADERS={
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY",
  "referrer-policy":"no-referrer",
  "x-robots-tag":"noindex, nofollow",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; "+
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function response(body:string,status:number,additional:Record<string,string>={}):Response{
  return new Response(body,{status,headers:{
    "content-type":"text/plain; charset=utf-8",...HEADERS,...additional,
  }});
}
function redirect(to:string,additional:Record<string,string>={}):Response{
  return new Response(null,{status:302,headers:{
    ...HEADERS,location:to,...additional,
  }});
}
function toBuffer(bytes:Uint8Array):ArrayBuffer{
  const buffer=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function base64url(bytes:Uint8Array):string{
  let raw="";
  for(const part of bytes)raw+=String.fromCharCode(part);
  return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function unbase64url(raw:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(raw)||raw.length%4===1||raw.length>MAX_COOKIE_SIZE)
    throw Error("Invalid token");
  const data=atob(raw.replace(/-/g,"+").replace(/_/g,"/")+
    "=".repeat((4-raw.length%4)%4));
  return Uint8Array.from(data,letter=>letter.charCodeAt(0));
}
function readConfig(env:PrivateEnvironment):Config|null{
  const origin=env.PUBLIC_ORIGIN?.trim().replace(/\/$/,"");
  const id=env.GITHUB_CLIENT_ID?.trim();
  const clientSecret=env.GITHUB_CLIENT_SECRET?.trim();
  const allowed=env.GITHUB_ALLOWED_USER_ID?.trim();
  const secret=env.SESSION_SECRET?.trim();
  if(!origin || !/^https:\/\/[a-zA-Z0-9.-]+$/.test(origin) ||
    new URL(origin).origin!==origin ||
    !id || !/^[A-Za-z0-9_]{10,128}$/.test(id) ||
    !clientSecret || clientSecret.length<20 ||
    !allowed || !/^[1-9][0-9]*$/.test(allowed) ||
    !Number.isSafeInteger(Number(allowed)) ||
    !secret || !/^[A-Za-z0-9_-]{43,}$/.test(secret))
    return null;
  try{
    const key=unbase64url(secret);
    if(key.length<32)return null;
    return {origin,clientId:id,clientSecret,
      allowedId:Number(allowed),secret:key};
  }catch{return null;}
}
function cookies(request:Request):Map<string,string>{
  const result=new Map<string,string>();
  for(const item of (request.headers.get("cookie")??"").split(";")){
    const sep=item.indexOf("=");
    if(sep>0)result.set(item.slice(0,sep).trim(),item.slice(sep+1).trim());
  }
  return result;
}
function setCookie(name:string,value:string,maxAge:number):string{
  return name+"="+value+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+maxAge;
}
function clearCookie(name:string):string{return setCookie(name,"",0);}
async function hmacKey(raw:Uint8Array):Promise<CryptoKey>{
  return crypto.subtle.importKey("raw",toBuffer(raw),
    {name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function sign(payload:object,config:Config):Promise<string>{
  const value=base64url(encoder.encode(JSON.stringify(payload)));
  const signed=await crypto.subtle.sign("HMAC",await hmacKey(config.secret),
    encoder.encode(value));
  return value+"."+base64url(new Uint8Array(signed));
}
async function verify<T extends object>(raw:string|undefined,
  config:Config):Promise<T|null>{
  if(!raw||raw.length>MAX_COOKIE_SIZE)return null;
  const parts=raw.split(".");
  if(parts.length!==2)return null;
  try{
    const signed=unbase64url(parts[1]);
    if(signed.length!==32)return null;
    const valid=await crypto.subtle.verify("HMAC",
      await hmacKey(config.secret),toBuffer(signed),
      encoder.encode(parts[0]));
    if(!valid)return null;
    const obj:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true})
      .decode(unbase64url(parts[0])));
    return obj && typeof obj==="object"&&!Array.isArray(obj)?obj as T:null;
  }catch{return null;}
}
function randomUrl(count:number):string{
  const b=new Uint8Array(count);
  crypto.getRandomValues(b);
  return base64url(b);
}
async function pkceChallenge(verifier:string):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(verifier));
  return base64url(new Uint8Array(digest));
}
function loginPage():Response{
  const html=[
    '<!doctype html><html lang="pt-PT"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Schedule Engine — Acesso privado</title>',
    '<style>body{font:16px system-ui,sans-serif;color:#183248;background:#f4f7fa;min-height:100vh;display:grid;place-items:center;margin:0}',
    'main{background:white;border:1px solid #d9e3ed;border-radius:14px;padding:32px;max-width:400px;box-shadow:0 10px 35px #102b4212}',
    'h1{margin:0 0 12px;font-size:25px}p{line-height:1.5;color:#435565}',
    'a{display:inline-block;background:#075e68;color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:12px}</style>',
    '</head><body><main><h1>Schedule Engine</h1><p>Ambiente privado de desenvolvimento.',
    'A entrada requer a conta GitHub autorizada.</p><a href="/auth/start">Entrar com GitHub</a></main></body></html>',
  ].join("");
  return new Response(html,{status:200,headers:{
    ...HEADERS,"content-type":"text/html; charset=utf-8",
  }});
}
async function session(request:Request,config:Config):Promise<boolean>{
  const result=await verify<Session>(cookies(request).get(COOKIE_SESSION),config);
  const now=Math.floor(Date.now()/1000);
  return !!result&&result.sub===config.allowedId &&
    typeof result.issued==="number"&&result.issued<=now &&
    typeof result.expires==="number"&&result.expires>now &&
    result.expires-result.issued===SESSION_SECONDS;
}
async function start(config:Config):Promise<Response>{
  const nonce=randomUrl(32),verifier=randomUrl(32),issued=Math.floor(Date.now()/1000);
  const state=await sign({nonce,verifier,issued},config);
  const url=new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id",config.clientId);
  url.searchParams.set("redirect_uri",config.origin+"/auth/callback");
  url.searchParams.set("state",nonce);
  url.searchParams.set("code_challenge",await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method","S256");
  // Deliberately NO repo, org, read:user or other OAuth scopes.
  url.searchParams.set("scope","");
  return redirect(url.toString(),{"set-cookie":setCookie(COOKIE_STATE,state,STATE_SECONDS)});
}
async function callback(request:Request,config:Config,
  fetcher:HttpFetcher):Promise<Response>{
  const url=new URL(request.url);
  const nonce=url.searchParams.get("state");
  const code=url.searchParams.get("code");
  const state=await verify<OAuthState>(cookies(request).get(COOKIE_STATE),config);
  const issued=state?.issued;
  const now=Math.floor(Date.now()/1000);
  const clear={"set-cookie":clearCookie(COOKIE_STATE)};
  if(!nonce || !code || nonce.length>256 || code.length>512 ||
    !state || state.nonce!==nonce ||
    !/^[A-Za-z0-9_-]{40,128}$/.test(state.verifier) ||
    typeof issued!=="number" || issued>now || now-issued>STATE_SECONDS)
    return response("Autenticação não concluída. Recomeça a entrada.",403,clear);
  let bearer:string;
  try{
    const exchange=await fetcher("https://github.com/login/oauth/access_token",{
      method:"POST",redirect:"error",
      headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({
        client_id:config.clientId,client_secret:config.clientSecret,
        code,redirect_uri:config.origin+"/auth/callback",
        code_verifier:state.verifier,
      }).toString(),
    });
    if(!exchange.ok)throw Error("GitHub code exchange failed");
    const json:unknown=await exchange.json();
    const token=(json as {access_token?:unknown})?.access_token;
    if(typeof token!=="string"||token.length<8||token.length>2048)
      throw Error("GitHub OAuth token missing");
    bearer=token;
  }catch{return response("Falha ao confirmar o login GitHub.",502,clear);}
  try{
    const profile=await fetcher("https://api.github.com/user",{
      method:"GET",redirect:"error",
      headers:{
        accept:"application/vnd.github+json",
        authorization:"Bearer "+bearer,
        "user-agent":"schedule-engine-private",
        "x-github-api-version":"2022-11-28",
      },
    });
    if(!profile.ok)throw Error("Profile lookup failed");
    const data:unknown=await profile.json();
    const id=(data as {id?:unknown})?.id;
    // Username and email are mutable; only the stable numeric ID from the
    // authenticated GitHub API identifies the owner.
    if(typeof id!=="number"||id!==config.allowedId)
      return response("Conta GitHub não autorizada.",403,clear);
  }catch{return response("Não foi possível validar a identidade.",502,clear);}
  const signed=await sign({
    sub:config.allowedId,issued:now,expires:now+SESSION_SECONDS,
  },config);
  const headers=new Headers({...HEADERS,location:"/horarios"});
  headers.append("set-cookie",clearCookie(COOKIE_STATE));
  headers.append("set-cookie",setCookie(COOKIE_SESSION,signed,SESSION_SECONDS));
  return new Response(null,{status:302,headers});
}
export function createPrivateAssetHandler(fetcher:HttpFetcher=fetch){
  return async function handle(request:Request,env:PrivateEnvironment):Promise<Response>{
    const config=readConfig(env);
    if(!config)return response("Serviço privado não configurado.",503);
    const url=new URL(request.url);
    // Avoid Host-header poisoning and using the OAuth app with a rogue origin.
    if(url.origin!==config.origin)return response("Domínio não autorizado.",403);
    if(request.method!=="GET" && request.method!=="HEAD" &&
      !(request.method==="POST"&&url.pathname==="/auth/logout"))
      return response("Método não permitido.",405);
    if(url.pathname==="/auth/start"){
      if(request.method!=="GET")return response("Método não permitido.",405);
      return start(config);
    }
    if(url.pathname==="/auth/callback"){
      if(request.method!=="GET")return response("Método não permitido.",405);
      return callback(request,config,fetcher);
    }
    if(url.pathname==="/auth/logout"){
      if(request.method!=="POST" ||
        request.headers.get("origin")!==config.origin)
        return response("Ação não autorizada.",403);
      return redirect("/",{"set-cookie":clearCookie(COOKIE_SESSION)});
    }
    const authorized=await session(request,config);
    if(!authorized){
      if(url.pathname==="/"&&request.method==="GET")
        return loginPage();
      return response("Autenticação necessária.",401);
    }
    if(url.pathname==="/")return redirect("/horarios");
    if(request.method!=="GET"&&request.method!=="HEAD")
      return response("Método não permitido.",405);
    if(url.pathname.startsWith("/api/"))
      return response("API não disponível nesta fase.",404);
    const asset=await env.ASSETS.fetch(request);
    const headers=new Headers(asset.headers);
    for(const [key,value] of Object.entries(HEADERS))headers.set(key,value);
    headers.delete("access-control-allow-origin");
    // Login has its own stringent CSP; app assets retain React/Vite
    // compatibility, but nobody can embed protected content.
    headers.set("content-security-policy","frame-ancestors 'none'");
    return new Response(asset.body,{
      status:asset.status,statusText:asset.statusText,headers,
    });
  };
}
const handler=createPrivateAssetHandler();
export default {
  fetch(request:Request,env:PrivateEnvironment):Promise<Response>{
    return handler(request,env);
  },
};
