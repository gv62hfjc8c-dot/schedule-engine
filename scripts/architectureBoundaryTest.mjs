/**
 * PR #47 / Checkpoint E — verify the live application dependency graph.
 * Domain validators and the experimental approval ledger are retained for
 * regression tests, but approval commands must NEVER be imported into a
 * public UI until a dedicated trusted-server workflow is approved.
 */
import {readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {resolve,relative,dirname,extname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const src=resolve(root,"src");
const scan=(dir)=>{
  const paths=[];
  for(const entry of readdirSync(dir)){
    const abs=resolve(dir,entry);
    if(statSync(abs).isDirectory()){paths.push(...scan(abs));continue;}
    if(/\.(tsx?|mjs)$/.test(abs)) paths.push(abs);
  }
  return paths;
};
const paths=scan(src);
const norm=abs=>relative(root,abs).replaceAll("\\","/");
const source=abs=>readFileSync(abs,"utf8");
const imports=code=>{
  const matches=[...code.matchAll(/(?:from\s*|import\s*\(|import\s*|require\s*\()\s*["']([^"']+)["']/g)];
  return [...new Set(matches.map(m=>m[1]))];
};
const resolveRelative=(from,request)=>{
  if(!request.startsWith("."))return null;
  const raw=resolve(dirname(from),request);
  const options=[raw,raw+".ts",raw+".tsx",raw+".mjs",raw.replace(/\.js$/,".ts"),
    resolve(raw,"index.ts"),resolve(raw,"index.tsx")];
  const match=options.find(p=>existsSync(p)&&statSync(p).isFile());
  assert.ok(match,"Unresolved relative import "+request+" in "+norm(from));
  assert.ok(match.startsWith(src+"/")||match===src,
    "Runtime source may not import archived/external files: "+norm(match));
  return match;
};
const references=new Map(paths.map(p=>[p,[]]));
for(const file of paths){
  for(const imp of imports(source(file))){
    const dep=resolveRelative(file,imp);
    if(dep&&references.has(dep)) references.get(dep).push(file);
  }
}
const entry=resolve(src,"main.tsx");
const live=new Set(),stack=[entry];
while(stack.length){
  const file=stack.pop();
  if(live.has(file))continue;
  live.add(file);
  for(const imp of imports(source(file))){
    const dep=resolveRelative(file,imp);
    if(dep&&!live.has(dep))stack.push(dep);
  }
}
const forbidden=[
  "src/application/executeApprovedScheduleCommand.ts",
  "src/persistence/supabaseApprovedLedgerRepository.ts",
  "src/utils/approvedSchedules.ts",
  "src/components/ApprovedContextIntegrationLab.tsx",
  "src/components/DailyGeneratorPanel.tsx",
  "src/components/PeriodGeneratorPanel.tsx",
];
for(const name of forbidden){
  assert.ok(!live.has(resolve(root,name)),
    "Retired approval/demo module imported by the live application: "+name);
}
for(const name of forbidden.slice(3)){
  assert.ok(!existsSync(resolve(root,name)),
    "Dormant interactive lab should remain in Git history, not active source: "+name);
}
for(const name of [
  "src/utils/constrainedPeriodGenerator.ts",
  "src/utils/finalScheduleCertification.ts",
  "src/utils/workConstraints.ts",
  "src/utils/workCoverage.ts",
  "src/utils/availability.ts",
  "src/utils/personSchedulingPolicies.ts",
  "src/utils/accountingCycleConfiguration.ts",
  "src/utils/mealAwareDayGenerator.ts",
]){
  const file=resolve(root,name);
  const code=source(file);
  assert.doesNotMatch(code,/\b(?:window|document|localStorage|sessionStorage)\s*[.[]/,
    "Domain scheduling core must not couple to browser globals: "+name);
  for(const imp of imports(code)){
    assert.ok(!/react|supabase|persistence|components/.test(imp),
      "Domain scheduling core imported an external technology: "+name+" -> "+imp);
  }
}
const liveNames=[...live].map(norm);
assert.ok(liveNames.includes("src/components/ConstrainedPeriodGeneratorPanel.tsx"),
  "The real constrained generator must be available.");
assert.ok(liveNames.includes("src/components/ScheduleHome.tsx"),
  "The monthly archive and daily UI must remain available.");
const dormant=forbidden.slice(0,3).filter(name=>existsSync(resolve(root,name)));
console.log("PR47-E: live dependency graph valid",JSON.stringify({
  filesScanned:paths.length,liveModules:live.size,
  archivedExperimentalUI:forbidden.slice(3).length,
  preservedTestedApprovalModules:dormant.length,
}));
