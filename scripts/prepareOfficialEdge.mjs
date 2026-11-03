/**
 * Prepare a deterministic source graph for the trusted Edge function.
 *
 * The browser code uses TypeScript/Vite-style extensionless relative imports.
 * Deno requires explicit .ts extensions. This script copies the SAME domain
 * source files with only import specifiers normalized. No duplicated rules.
 *
 * Deployment artifacts are intentionally ignored by git.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const root=resolve(".");
const entry="supabase/functions/official-schedules/index.ts";
const output=join(root,".edge-build");
const pending=[entry],handled=new Set();
let bytes=0;

rmSync(output,{recursive:true,force:true});
while(pending.length){
  const file=pending.shift();
  if(handled.has(file))continue;
  handled.add(file);
  const from=resolve(root,file);
  const source=readFileSync(from,"utf8");
  const dependencies=[];
  const prepared=source.replace(
    /((?:from\s*|import\s*)["'])(\.[^"']+)(["'])/g,
    (_whole,quote,importPath,end)=>{
      const extension=importPath.endsWith(".ts")?importPath:importPath+".ts";
      const target=normalize(join(dirname(file),extension));
      const scope=relative(root,resolve(root,target));
      if(scope.startsWith(".."))throw Error("Import outside repository: "+target);
      dependencies.push(target);
      return quote+extension+end;
    }
  );
  for(const dep of dependencies)pending.push(dep);
  const target=join(output,file);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,prepared,"utf8");
  bytes+=prepared.length;
}
if(handled.size<5)throw Error("Incomplete Edge source graph");
console.log("Trusted Edge source graph prepared:",handled.size,
  "files,",bytes,"bytes in .edge-build");
