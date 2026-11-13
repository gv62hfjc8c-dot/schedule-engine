// V1: conservative map of runtime imports. Candidates require manual review before deletion.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const walk = (directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
      const p=path.join(directory,entry.name);
      return entry.isDirectory()?walk(p):[p];
    })
  : [];
const all=walk(path.join(root,"src"))
  .filter(p=>/\.(?:ts|tsx|css)$/.test(p) && !p.endsWith(".d.ts"))
  .map(p=>path.relative(root,p).replaceAll(path.sep,"/"));
const existing=new Set(all);
const test=(p)=>/(?:Test|\.test)\.(?:ts|tsx)$/.test(p);
const production=all.filter(p=>!test(p));
const norm=(p)=>path.posix.normalize(p);
const resolve=(from,spec)=>{
  if(!spec.startsWith("."))return null;
  const raw=norm(path.posix.join(path.posix.dirname(from),spec));
  return [raw,raw+".ts",raw+".tsx",raw+".css",raw+"/index.ts",raw+"/index.tsx"]
    .find(item=>existing.has(item))??null;
};
const graph=new Map(all.map(p=>[p,new Set()]));
for(const file of all){
  const source=fs.readFileSync(path.join(root,file),"utf8");
  const importExport=/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/g;
  const dynamic=/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for(const regex of [importExport,dynamic]){
    for(const match of source.matchAll(regex)){
      const dep=resolve(file,match[1]);
      if(dep)graph.get(file).add(dep);
    }
  }
}
const reach=(starts)=>{
  const seen=new Set();
  const queue=[...starts];
  while(queue.length){
    const file=queue.shift();
    if(seen.has(file) || !existing.has(file))continue;
    seen.add(file);
    queue.push(...graph.get(file));
  }
  return seen;
};
const runtime=reach(["src/main.tsx"]);
const tests=reach(all.filter(test));
const onlyTest=production.filter(p=>!runtime.has(p)&&tests.has(p)).sort();
const unreferenced=production.filter(p=>!runtime.has(p)&&!tests.has(p)).sort();
console.log("V1_MODULE_MAP",JSON.stringify({
  files:all.length,production:production.length,runtimeReachable:runtime.size,
  testOnly:onlyTest,unreachable:unreferenced,
},null,2));
// An imported production file is never a safe deletion candidate.
// This is a report, not a destructive automatic cleanup.
