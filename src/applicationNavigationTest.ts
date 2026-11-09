import {areaFor,sectionLabel,PRIMARY_NAV,SECONDARY_NAV} from "./components/ApplicationNavigation";
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const expected={
  schedules:"schedules",generator:"schedules",calendar:"operation",
  presence:"operation",people:"team",availability:"team",workRules:"rules",
} as const;
for(const [section,area] of Object.entries(expected)){
  assert(areaFor(section as keyof typeof expected)===area,
    "Wrong parent workspace for "+section);
  assert(sectionLabel(section as keyof typeof expected).length>0,
    "Missing accessible page heading for "+section);
}
assert(PRIMARY_NAV.length===4,"The shell must not introduce phantom product areas.");
assert(SECONDARY_NAV.length===4,"Operation and team subsections are preserved.");
assert(new Set(SECONDARY_NAV.map(item=>item.section)).size===SECONDARY_NAV.length,
  "Subsections must remain unique.");
console.log("App Shell navigation: all seven real views retain named parent areas.");
