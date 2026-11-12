import {validSchedulingDate} from "./utils/personSchedulingPolicies";
import {
  calendarMonth,formatCivilDate,parseCivilDateInput,
  isoCivilDate,shiftCalendarMonth,
} from "./utils/civilDatePicker";

function assert(condition:unknown,message:string):asserts condition {
  if(!condition)throw Error("PR67: "+message);
}
assert(parseCivilDateInput("12/11/2026")==="2026-11-12",
  "Portuguese civil date must be converted to ISO.");
assert(parseCivilDateInput("1/2/2028")==="2028-02-01",
  "Single-digit human month/day must normalize.");
assert(parseCivilDateInput("2026-11-30")==="2026-11-30",
  "ISO date entry preserves existing WebKit and form behavior.");
assert(parseCivilDateInput("31/11/2026")===null,
  "Impossible calendar day must not reach the engine.");
assert(parseCivilDateInput("29/02/2027")===null,
  "Non-leap-day must be rejected.");
assert(parseCivilDateInput("29/02/2028")==="2028-02-29",
  "Leap-day must be accepted.");
assert(parseCivilDateInput("2026-13-01")===null,
  "Invalid ISO month must be rejected.");
assert(parseCivilDateInput("12-11-2026")===null,
  "Ambiguous manual date format must be rejected.");
assert(formatCivilDate("2026-11-12")==="12/11/2026",
  "Visual date is consistently pt-PT.");
assert(formatCivilDate("")==="","Missing optional date must stay empty.");
assert(isoCivilDate(2026,11,12)==="2026-11-12",
  "Chosen calendar day must preserve ISO storage semantics.");
assert(validSchedulingDate(isoCivilDate(2026,11,12)),
  "Calendar selection must generate valid civil dates.");
const november=calendarMonth(2026,11);
assert(november.offset===6&&november.days===30&&november.rows===6,
  "Calendar grid starts Monday and includes all November 2026 days.");
const february=calendarMonth(2028,2);
assert(february.days===29&&february.rows===5,
  "Leap-year grid must contain 29 February.");
assert(calendarMonth(1900,2).days===28,
  "Non-leap century must remain 28 days.");
assert(calendarMonth(1,1).days===31,
  "Calendar uses full ISO civil year range, including years < 100.");
assert(shiftCalendarMonth(2026,12,1).year===2027&&
       shiftCalendarMonth(2026,12,1).month===1,
  "Next month must cross calendar years.");
assert(shiftCalendarMonth(2027,1,-1).year===2026&&
       shiftCalendarMonth(2027,1,-1).month===12,
  "Previous month must cross calendar years.");
assert(shiftCalendarMonth(1,1,-1).year===1 &&
       shiftCalendarMonth(1,1,-1).month===1,
  "Calendar must not underflow valid date range.");
console.log("PR67: pt-PT date display, ISO persistence, leap years, month navigation PASS.");
