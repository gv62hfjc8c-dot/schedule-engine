import {validateWeeklyOpeningHours, type WeeklyOpeningHours} from "./operatingHours";
import {validateTeamRoster} from "./team";

/**
 * The organisation's opening windows are the default scheduling eligibility
 * for every active person. No per-person availability state is stored.
 *
 * An inactive person has no eligible windows. Invalid source data fails closed.
 * These windows are possibilities, never assigned shifts or working hours.
 */
export function eligibleOpeningWindows(
  member:unknown,
  openingHours:unknown
):WeeklyOpeningHours|null {
  const hours=validateWeeklyOpeningHours(openingHours);
  const team=validateTeamRoster({members:[member]});
  if(!hours.valid || !team.valid)return null;
  const active=team.value.members[0].active;
  return {
    days:hours.value.days.map(({day,intervals})=>({
      day,
      intervals:active ? intervals.map(({start,end})=>({start,end})) : [],
    })),
  };
}
