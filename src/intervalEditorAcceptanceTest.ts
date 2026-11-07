import type { TimeInterval } from "./types";
import {
  addInterval, editInterval, removeInterval, validateEditedIntervals,
} from "./utils/intervalEditing";
import {intersectIntervals} from "./utils/availability";
import {getOperatingIntervalsForDate} from "./utils/operatingCalendar";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import type {WeeklyOperatingHours} from "./types";

function ok(check:unknown,message:string):asserts check {
  if(!check)throw Error("PR47 interval acceptance: "+message);
}
const operating=[{start:"09:00",end:"12:00"},{start:"14:00",end:"18:00"}];
const prepared=validateEditedIntervals([...operating].reverse());
ok(prepared.valid && prepared.intervals[0].start==="09:00" &&
  prepared.intervals[1].start==="14:00",
  "Non-overlapping intervals are preserved and ordered.");
const original=structuredClone(operating);
const invalid=editInterval(original,0,{start:"09:00",end:"14:15"});
ok(!invalid.valid && JSON.stringify(original)===JSON.stringify(operating),
  "Invalid overlap is rejected without mutating stored intervals.");
const touching=editInterval(original,0,{start:"09:00",end:"14:00"});
ok(touching.valid,"Adjacent intervals are allowed; overlapping ones are not.");
ok(!validateEditedIntervals([{start:"10:00",end:"10:00"}]).valid,
  "Zero-length intervals are blocked.");
ok(!validateEditedIntervals([{start:"10:05",end:"11:00"}]).valid,
  "Invalid clock minute granularity is blocked.");
ok(!validateEditedIntervals([{start:"23:45",end:"00:00"}]).valid,
  "Crossing midnight is not silently treated as one civil day.");
ok(validateEditedIntervals([{start:"23:45",end:"24:00"}]).valid,
  "End of civil day remains editable.");

const allowed=[{start:"09:00",end:"12:00"},{start:"14:00",end:"18:00"}];
const startAvailability=[{start:"09:00",end:"12:00"}];
const added=addInterval(startAvailability,allowed);
ok(added.valid && added.intervals.length===2 &&
  added.intervals[1].start==="14:00" && added.intervals[1].end==="15:00",
  "A second availability period can be created inside the second opening period.");
ok(startAvailability.length===1,
  "Adding a new period does not silently overwrite the original.");
ok(!editInterval(added.valid?added.intervals:[],1,
  {start:"12:00",end:"15:00"},allowed).valid,
  "Availability spanning a closed operational gap is forbidden.");
ok(!addInterval([{start:"09:00",end:"18:00"}],
  [{start:"09:00",end:"18:00"}]).valid,
  "Cannot add overlapping availability until the original period is shortened.");
const shortened=editInterval([{start:"09:00",end:"18:00"}],0,
  {start:"09:00",end:"13:00"},[{start:"09:00",end:"18:00"}]);
ok(shortened.valid &&
  addInterval(shortened.intervals,[{start:"09:00",end:"18:00"}]).valid,
  "A previously contiguous day can be split using the actual editor.");

const recovered=removeInterval(
  [{start:"09:00",end:"12:00"},{start:"11:00",end:"14:00"}],1);
ok(recovered.valid && recovered.intervals.length===1,
  "The interface can remove a corrupt legacy period instead of trapping the user.");
const closed=removeInterval([{start:"09:00",end:"12:00"}],0);
ok(closed.valid && closed.intervals.length===0,
  "Removing the last period produces an explicitly closed/unavailable day.");

const weekly:WeeklyOperatingHours={
  monday:operating,tuesday:[],wednesday:[],thursday:[],
  friday:[],saturday:[],sunday:[],
};
const availability={
  personId:"test",weeklyAvailability:{
    ...createEmptyWeeklyAvailability(),
    monday:operating,
  },exceptions:[],
};
ok(intersectIntervals(availability.weeklyAvailability.monday,
  getOperatingIntervalsForDate("2026-11-02",weekly,[])).length===2,
  "The real availability pipeline retains two distinct opening periods.");
const exceptionalOperating=[{date:"2026-11-04",intervals:operating}];
ok(getOperatingIntervalsForDate("2026-11-04",weekly,exceptionalOperating).length===2,
  "The real operating calendar reads both exceptional intervals.");
console.log("PR47: multi-interval editor validation and operation/availability integration passed.");
