import { readProtectedApprovedPeriods } from "./persistence/readApprovedPeriodProtection";

const assert=(condition:boolean,message:string)=>{
  if(!condition)throw new Error(message);
};
const row=(records:unknown[],complete=true)=>[{
  ledger_version:2,
  payload:{version:2,complete,records},
}];
const approved={status:"approved",startDate:"2026-11-10",endDate:"2026-11-15"};
const superseded={status:"superseded",startDate:"2026-11-01",endDate:"2026-11-05"};
const client=(data:unknown,status=200)=>({
  user:{id:"owner-a",email:"test@example.invalid"},
  request:async()=>new Response(JSON.stringify(data),{status}),
});
const run=async()=>{
  const protectedRows=await readProtectedApprovedPeriods(client(row([approved,superseded])),"owner-a");
  assert(protectedRows.periods.length===1 &&
    protectedRows.periods[0].startDate==="2026-11-10",
    "Approved date ranges must be protected, not superseded ones.");
  const unknown=await readProtectedApprovedPeriods(client([]),"owner-a");
  assert(unknown.periods.length===0&&!unknown.contextKnown,
    "Missing ledger means unknown official context.");
  const partial=await readProtectedApprovedPeriods(client(row([approved],false)),"owner-a");
  assert(partial.periods.length===1&&!partial.contextKnown,
    "Known approvals remain protected even when history is incomplete.");
  let rejected=0;
  for(const [data,status,owner] of [
    [row([approved]),403,"owner-a"],
    [row([{...approved,startDate:"invalid"}]),200,"owner-a"],
    [row([approved]),200,"owner-b"],
    [[{ledger_version:2,payload:{version:1,complete:true,records:[]}}],200,"owner-a"],
  ] as const) {
    try {
      await readProtectedApprovedPeriods(client(data,status),owner);
    } catch {rejected++;}
  }
  assert(rejected===4,"Malformed, unauthorized or inaccessible approval context must fail closed.");
  console.log("PR47/P06: read-only approved-period protection tests passed.");
};
await run();
