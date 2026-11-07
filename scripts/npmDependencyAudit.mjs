/**
 * Dependency audit for the *exact* checked-in lockfile.
 *
 * npm audit normally exits 1 when advisories are found. Treat that as a
 * reported security result rather than mistaking it for a network failure.
 * Block unpatched high/critical production dependencies; report dev-tool
 * vulnerabilities separately so a major build-tool upgrade is deliberate.
 */
import {spawnSync} from "node:child_process";

const report = spawnSync("npm",["audit","--json"],{
  encoding:"utf8",timeout:120_000,maxBuffer:8*1024*1024,
});
if(report.error){
  console.error("npm audit não executou:",report.error.message);
  process.exit(1);
}
let data;
try { data=JSON.parse(report.stdout); }
catch{
  console.error("npm audit não devolveu JSON válido:",report.stderr.slice(0,500));
  process.exit(1);
}
if(data.error || (report.status!==0 && report.status!==1)){
  console.error("npm audit falhou:",JSON.stringify(data.error??report.stderr).slice(0,1200));
  process.exit(1);
}
const problems=Object.entries(data.vulnerabilities??{})
  .map(([name,issue])=>({
    name,severity:issue.severity,devOnly:Boolean(issue.isDirect?issue.isDev:issue.isDev),
    direct:Boolean(issue.isDirect),range:issue.range,
    fix:issue.fixAvailable,
    advisories:(issue.via??[]).filter(v=>typeof v==="object").map(v=>({
      title:v.title,url:v.url,range:v.range,severity:v.severity,
    })),
  }))
  .sort((a,b)=>["critical","high","moderate","low"].indexOf(a.severity)-
                ["critical","high","moderate","low"].indexOf(b.severity) ||
                a.name.localeCompare(b.name));
const totals=data.metadata?.vulnerabilities??{};
console.log("AUDITORIA_NPM_RESUMO",JSON.stringify(totals));
for(const problem of problems){
  console.log("AUDITORIA_NPM_ITEM",JSON.stringify(problem));
}
const production=spawnSync("npm",["audit","--omit=dev","--audit-level=high","--json"],{
  encoding:"utf8",timeout:120_000,maxBuffer:8*1024*1024,
});
let prod;
try{prod=JSON.parse(production.stdout);}catch{
  console.error("A auditoria das dependências de produção falhou.");
  process.exit(1);
}
if(prod.error || (production.status!==0 && production.status!==1)){
  console.error("Não foi possível verificar as dependências de produção.");
  process.exit(1);
}
console.log("AUDITORIA_PRODUCAO",JSON.stringify(prod.metadata?.vulnerabilities??{}));
const severe=Object.entries(prod.vulnerabilities??{})
  .filter(([,v])=>v.severity==="high"||v.severity==="critical")
  .map(([name])=>name);
if(severe.length){
  console.error("Dependências de produção com vulnerabilidades graves:",severe.join(", "));
  process.exit(1);
}
console.log("Auditoria concluída; vulnerabilidades do ambiente de desenvolvimento continuam identificadas acima.");
