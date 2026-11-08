import type { PersistedAppState } from "../persistence/stateRepository";

/**
 * Conservative three-way merge of two independently edited configurations.
 * Identical/disjoint changes merge; simultaneous modifications to the same
 * primitive value or unkeyed array conflict. Deletions cannot resurrect data.
 *
 * Call only after the remote payload and local payload pass schema validation.
 * Never auto-merge generated proposals or other immutable archives.
 */
type Json = string | number | boolean | null | Json[] | {[key:string]:Json};
const MISSING=Symbol("missing");
type Item=Json|typeof MISSING;
type MergeResult={ok:true;value:Item}|{ok:false;conflicts:string[]};
const eq=(a:Item,b:Item):boolean=>{
  if(a===MISSING||b===MISSING)return a===b;
  if(a===b)return true;
  if(typeof a!==typeof b || a===null||b===null)return false;
  if(Array.isArray(a)&&Array.isArray(b))
    return a.length===b.length && a.every((v,i)=>eq(v,b[i]));
  if(Array.isArray(a)||Array.isArray(b))return false;
  if(typeof a==="object"&&typeof b==="object"){
    const ak=Object.keys(a),bk=Object.keys(b);
    return ak.length===bk.length &&
      ak.every(k=>Object.hasOwn(b,k)&&eq(a[k],b[k]));
  }
  return false;
};
const object=(v:Item):v is {[key:string]:Json}=>
  v!==MISSING && typeof v==="object" && v!==null && !Array.isArray(v);
const at=(o:{[key:string]:Json},k:string):Item=>
  Object.hasOwn(o,k)?o[k]:MISSING;

const arraysWithKey=(arr:Item,key:string):arr is {[k:string]:Json}[]=>{
  if(!Array.isArray(arr))return false;
  const ids=new Set<string>();
  return arr.every(item=>{
    if(!object(item)||typeof item[key]!=="string"||!item[key] ||
      ids.has(item[key] as string))return false;
    ids.add(item[key] as string);
    return true;
  });
};
const keyFor=(path:string):string|null=>{
  if(path==="people")return "id";
  if(path==="availabilities")return "personId";
  if(path==="exceptions"||path==="presenceExceptions")return "date";
  return null;
};
function merge(base:Item,local:Item,remote:Item,path:string):MergeResult{
  if(eq(local,remote))return {ok:true,value:local};
  if(eq(base,local))return {ok:true,value:remote};
  if(eq(base,remote))return {ok:true,value:local};
  const key=keyFor(path);
  if(key && arraysWithKey(base,key) &&
    arraysWithKey(local,key)&&arraysWithKey(remote,key)){
    const left=new Map(base.map(v=>[v[key] as string,v]));
    const a=new Map(local.map(v=>[v[key] as string,v]));
    const b=new Map(remote.map(v=>[v[key] as string,v]));
    const order=[...new Set([...remote,...local,...base].map(v=>v[key] as string))];
    const result:Json[]=[];const conflicts:string[]=[];
    for(const id of order){
      const part=merge(left.get(id)??MISSING,a.get(id)??MISSING,
        b.get(id)??MISSING,path+"["+id+"]");
      if(!part.ok)conflicts.push(...part.conflicts);
      else if(part.value!==MISSING)result.push(part.value);
    }
    return conflicts.length?{ok:false,conflicts}:{ok:true,value:result};
  }
  if(object(base)&&object(local)&&object(remote)){
    const keys=[...new Set([...Object.keys(remote),...Object.keys(local),...Object.keys(base)])]
      .filter(k=>!["__proto__","prototype","constructor"].includes(k));
    const output:{[key:string]:Json}={};const conflicts:string[]=[];
    for(const k of keys){
      const child=merge(at(base,k),at(local,k),at(remote,k),
        path?path+"."+k:k);
      if(!child.ok)conflicts.push(...child.conflicts);
      else if(child.value!==MISSING)Object.defineProperty(output,k,{
        value:child.value,enumerable:true,configurable:true,writable:true,
      });
    }
    return conflicts.length?{ok:false,conflicts}:{ok:true,value:output};
  }
  return {ok:false,conflicts:[path||"(raiz)"]};
}
export type StateMerge =
  | {ok:true;state:PersistedAppState}
  | {ok:false;conflicts:string[]};
export function mergePersistedStates(
  baseline:PersistedAppState,
  local:PersistedAppState,
  remote:PersistedAppState,
):StateMerge{
  const merged=merge(baseline as unknown as Json,local as unknown as Json,
    remote as unknown as Json,"");
  if(!merged.ok)return merged;
  if(!object(merged.value))return {ok:false,conflicts:["(raiz)"]};
  return {ok:true,state:merged.value as unknown as PersistedAppState};
}
