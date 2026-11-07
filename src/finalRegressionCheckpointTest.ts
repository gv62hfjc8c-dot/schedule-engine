import type { Person, DatedWorkShift, OperatingCalendarConfiguration } from "./types";
import type { StoredGeneratedSchedule } from "./persistence/generatedScheduleRepository";
import { weeklyPersonWorkSummary,formatWorkMinutes } from "./utils/weeklyWorkSummary";
import { archiveDayState,unreadableArchiveAffectsDate } from "./utils/savedScheduleView";
import { effectiveShiftMinutes } from "./utils/monthlyScheduleView";

function assert(value:unknown,message:string):asserts value {
  if (!value) throw Error("PR47-F: "+message);
}
const zero=(personId:string):Person=>({id:personId,name:personId,active:true});
const person:Person={
  ...zero("part"),weeklyContractMinutes:1200,weeklyTargetMinutes:900,
};
const shift=(date:string,start:string,end:string,personId="part"):DatedWorkShift=>({
  date,personId,interval:{start,end},mealBreak:null,
});
const work=[
  shift("2026-11-02","09:00","15:00"),
  shift("2026-11-03","09:00","15:00"),
  shift("2026-11-04","09:00","15:00"),
];
const stats=weeklyPersonWorkSummary(person,work,"Atlantic/Azores",2400);
assert(stats.effectiveMinutes===1080 && stats.targetMinutes===900 &&
  stats.hardMaximumMinutes===1200 && stats.deficitMinutes===0 &&
  stats.aboveTargetMinutes===180,
  "An 18-hour week is above a 15h SOFT target but below a 20h HARD ceiling.");
const empty=weeklyPersonWorkSummary(person,[],"Atlantic/Azores",2400);
assert(empty.effectiveMinutes===0 && empty.deficitMinutes===900,
  "Missing work is zero effective hours, not an implied rest day.");
const legacy=weeklyPersonWorkSummary(zero("legacy"),[],"Atlantic/Azores",2400);
assert(legacy.targetMinutes===2400 && legacy.hardMaximumMinutes===2400,
  "Legacy person with no contract keeps the 40h default.");
const constrained=weeklyPersonWorkSummary(
  {...person,weeklyContractMinutes:3000,weeklyTargetMinutes:2100},
  [],"Atlantic/Azores",2400);
assert(constrained.targetMinutes===2100&&constrained.hardMaximumMinutes===2400,
  "The company maximum remains a hard limit even for higher contracts.");
const spring=shift("2026-03-29","00:30","03:30");
const springStats=weeklyPersonWorkSummary(person,[spring],"Europe/Lisbon",2400);
assert(springStats.effectiveMinutes===120 && effectiveShiftMinutes(spring,"Europe/Lisbon")===120,
  "DST leap forward is two actual hours, not three wall-clock hours.");
const fall=shift("2026-10-25","01:30","03:30");
const fallStats=weeklyPersonWorkSummary(person,[fall],"Europe/Lisbon",2400);
assert(fallStats.effectiveMinutes===null &&
  formatWorkMinutes(fallStats.effectiveMinutes)==="Por confirmar",
  "DST ambiguity is not silently presented as a certified duration.");
assert(formatWorkMinutes(1080)==="18h00" &&
  formatWorkMinutes(905)==="15h05",
  "Weekly workload display uses actual minute precision.");

const operation:OperatingCalendarConfiguration={
  weeklyOperatingHours:{
    monday:[{start:"09:00",end:"18:00"}],
    tuesday:[{start:"09:00",end:"18:00"}],
    wednesday:[],thursday:[],friday:[],saturday:[],sunday:[],
  },exceptions:[],
};
const record={
  id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startDate:"2026-11-02",endDate:"2026-11-03",timeZone:"Atlantic/Azores",
  createdAt:"2026-11-07T12:00:00Z",
  payload:{configuration:{operatingCalendar:operation},shifts:[],people:[]},
} as unknown as StoredGeneratedSchedule;
const partial={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  startDate:"2026-11-04",endDate:"2026-11-06"};
const status=(date:string,extras:Partial<Parameters<typeof archiveDayState>[0]>={})=>
  archiveDayState({
    date,records:[record],unreadable:[],operation,loadState:"ready",
    focusedProposalId:null,...extras,
  });
assert(status("2026-11-02")==="proposal",
  "Archived proposal recognized only when its original date is selected.");
assert(status("2026-11-04")==="closed",
  "A genuinely closed unassigned day is closed when archive is fully known.");
assert(status("2026-11-04",{unreadable:[partial]})==="unknown",
  "Corrupt overlapping archive wins over 'closed' or 'unplanned'.");
assert(status("2026-11-02",{loadState:"loading"})==="loading" &&
  status("2026-11-02",{loadState:"failed"})==="failed",
  "Loading or server errors cannot be labelled 'unplanned'.");
assert(status("2026-11-04",{focusedProposalId:record.id,
  unreadable:[partial]})==="outside-proposal",
  "Focused view does not infer data outside its original archived period.");
assert(status("2026-11-02",{focusedProposalId:record.id})==="proposal",
  "Focused view preserves original snapshot.");
assert(status("2026-11-02",{focusedProposalId:"unknown-proposal"})==="outside-proposal",
  "Unknown focused snapshot never imports the latest other proposal.");
assert(!unreadableArchiveAffectsDate([partial],"2026-11-02") &&
  unreadableArchiveAffectsDate([partial],"2026-11-05"),
  "Corruption is restricted to affected days when date metadata is usable.");
assert(status("2026-11-02",{unreadable:[{id:null,startDate:null,endDate:null}]})==="proposal",
  "Verified snapshot can be shown with a separately signalled incomplete archive.");
assert(status("2026-11-04",{unreadable:[{id:null,startDate:null,endDate:null}]})==="unknown",
  "Unbounded corruption makes all dates without a verified snapshot uncertain.");
console.log("PR47-F: person contract vs soft target, actual DST minutes, and fail-closed calendar states passed.");
