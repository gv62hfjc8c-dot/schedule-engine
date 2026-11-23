/**
 * PR98 — private Cloudflare Worker shell, completely independent of scheduling.
 *
 * SECURITY:
 * - All asset requests reach this Worker first (wrangler run_worker_first).
 * - A Cloudflare Access assertion is verified cryptographically, including
 *   issuer, audience, expiry and the ONLY permitted email.
 * - No Access configuration = fail closed (503), never a public fallback.
 * - No personal data, account settings or secrets are bundled into Vite.
 */
export interface PrivateEnvironment {
  ASSETS: {fetch(request:Request):Promise<Response>};
  ACCESS_TEAM_DOMAIN?:string;
  ACCESS_APPLICATION_AUD?:string;
  ACCESS_OWNER_EMAIL?:string;
}
interface AccessConfig {
  issuer:string;
  audience:string;
  ownerEmail:string;
}
interface AccessClaims {
  iss?:unknown;
  aud?:unknown;
  exp?:unknown;
  nbf?:unknown;
  iat?:unknown;
  email?:unknown;
}
interface PublicJwk {
  kty?:string;
  kid?:string;
  alg?:string;
  use?:string;
  n?:string;
  e?:string;
}
interface JwkSet {keys:PublicJwk[]}
export type PublicKeyFetcher=(url:string)=>Promise<JwkSet>;
const MAX_JWT_LENGTH=8192;
const MAX_JWKS_LENGTH=65536;
const JWKS_TTL_MS=5*60*1000;
const TOKEN_HEADER="cf-access-jwt-assertion";
const encoder=new TextEncoder();

function configured(env:PrivateEnvironment):AccessConfig|null{
  const issuer=env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/,"");
  const audience=env.ACCESS_APPLICATION_AUD?.trim();
  const ownerEmail=env.ACCESS_OWNER_EMAIL?.trim().toLowerCase();
  // Do not permit arbitrary issuer origins: they could act as SSRF targets.
  if(!issuer||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||
    !audience||!/^[a-zA-Z0-9_-]{12,128}$/.test(audience)||
    !ownerEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
    return null;
  return {issuer,audience,ownerEmail};
}
function protectedReply(message:string,status:number):Response{
  return new Response(message,{
    status,headers:{
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      "x-robots-tag":"noindex, nofollow",
      "referrer-policy":"no-referrer",
    },
  });
}
function fromBase64url(input:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(input) ||
    input.length%4===1)throw Error("Malformed token");
  const padding="=".repeat((4-input.length%4)%4);
  const binary=atob(input.replace(/-/g,"+").replace(/_/g,"/")+padding);
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
}
function parseSegment(value:string):Record<string,unknown>{
  const bytes=fromBase64url(value);
  if(bytes.byteLength>8192)throw Error("Oversized segment");
  const json=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(!json || typeof json!=="object" || Array.isArray(json))
    throw Error("Invalid claims");
  return json as Record<string,unknown>;
}
function toBuffer(view:Uint8Array):ArrayBuffer{
  const buffer=new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}
async function fetchKeysFromCloudflare(url:string):Promise<JwkSet>{
  const response=await fetch(url,{
    headers:{accept:"application/json"},
    redirect:"error",
  });
  if(!response.ok)throw Error("JWKS unavailable");
  const raw=await response.text();
  if(raw.length>MAX_JWKS_LENGTH)throw Error("Invalid JWKS size");
  const result:unknown=JSON.parse(raw);
  if(!result || typeof result!=="object" || Array.isArray(result) ||
    !Array.isArray((result as JwkSet).keys))throw Error("Invalid JWKS");
  return result as JwkSet;
}
async function verifyAccessToken(
  token:string,config:AccessConfig,
  publicKeys:JwkSet,nowSeconds:number,
):Promise<boolean>{
  if(token.length>MAX_JWT_LENGTH)return false;
  const parts=token.split(".");
  if(parts.length!==3)return false;
  const header=parseSegment(parts[0]);
  const claims=parseSegment(parts[1]) as AccessClaims;
  if(header.alg!=="RS256" || typeof header.kid!=="string" ||
    !header.kid || header.kid.length>256)return false;
  if(claims.iss!==config.issuer||
    !(claims.aud===config.audience||
      Array.isArray(claims.aud)&&claims.aud.includes(config.audience))||
    typeof claims.email!=="string"||
    claims.email.trim().toLowerCase()!==config.ownerEmail||
    typeof claims.exp!=="number"||
    !Number.isFinite(claims.exp)||claims.exp<=nowSeconds||
    (claims.nbf!==undefined && (typeof claims.nbf!=="number"||
      claims.nbf>nowSeconds))||
    (claims.iat!==undefined && (typeof claims.iat!=="number"||
      claims.iat>nowSeconds+60)))return false;
  const jwk=publicKeys.keys.find(key=>key.kid===header.kid);
  if(!jwk || jwk.kty!=="RSA"||
    (jwk.alg!==undefined && jwk.alg!=="RS256")||
    (jwk.use!==undefined && jwk.use!=="sig")||
    !jwk.n || !jwk.e)return false;
  const cryptoKey=await crypto.subtle.importKey("jwk",{
    kty:"RSA",n:jwk.n,e:jwk.e,
    alg:"RS256",ext:true,key_ops:["verify"],
  },{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const signature=toBuffer(fromBase64url(parts[2]));
  const signed=toBuffer(encoder.encode(parts[0]+"."+parts[1]));
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5",cryptoKey,
    signature,signed);
}

/**
 * Factory injection makes signature verification and fail-closed behavior
 * testable without Cloudflare credentials or accessing the network.
 */
export function createPrivateAssetHandler(
  getKeys:PublicKeyFetcher=fetchKeysFromCloudflare,
){
  let cache:{issuer:string;updatedAt:number;keys:JwkSet}|null=null;
  return async function handle(request:Request,env:PrivateEnvironment):Promise<Response>{
    const config=configured(env);
    if(!config)return protectedReply("Serviço privado não configurado.",503);
    const assertion=request.headers.get(TOKEN_HEADER);
    if(!assertion)return protectedReply("Acesso privado obrigatório.",403);
    try{
      const now=Date.now();
      if(!cache || cache.issuer!==config.issuer ||
        now-cache.updatedAt>JWKS_TTL_MS){
        cache={issuer:config.issuer,updatedAt:now,
          keys:await getKeys(config.issuer+"/cdn-cgi/access/certs")};
      }
      const verified=await verifyAccessToken(
        assertion,config,cache.keys,Math.floor(now/1000));
      if(!verified)return protectedReply("Acesso não autorizado.",403);
    }catch{
      return protectedReply("Acesso não autorizado.",403);
    }
    if(request.method!=="GET"&&request.method!=="HEAD")
      return protectedReply("Método não permitido.",405);
    // The login screen in the frontend is intentionally a placeholder.
    // Access is the REAL login for this private deployment, so land directly
    // on the workspace rather than show a fake password form.
    if(new URL(request.url).pathname==="/"){
      return new Response(null,{status:302,headers:{
        location:"/horarios",
        "cache-control":"no-store",
        "x-robots-tag":"noindex, nofollow",
      }});
    }
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    headers.set("cache-control","private, no-store");
    headers.set("x-content-type-options","nosniff");
    headers.set("x-frame-options","DENY");
    headers.set("content-security-policy","frame-ancestors 'none'");
    headers.set("referrer-policy","no-referrer");
    headers.set("x-robots-tag","noindex, nofollow");
    headers.delete("access-control-allow-origin");
    return new Response(response.body,{
      status:response.status,statusText:response.statusText,headers,
    });
  };
}
const handle=createPrivateAssetHandler();
export default {
  fetch(request:Request,env:PrivateEnvironment):Promise<Response>{
    return handle(request,env);
  },
};
