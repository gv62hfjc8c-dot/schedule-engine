/**
 * PR91 — Pure, bounded optimizer for 4 complete civil weeks (28 days).
 *
 * This module never chooses who works, removes/adds a workday, or changes
 * shift/meal placement. It only transfers effective work minutes between
 * ALREADY selected normal workdays of the same employee, across weeks.
 * The day scheduler and independent certifier remain authoritative.
 */
import {addCivilDays} from "./schedulePeriods";

export interface CycleWorkday {
  date:string;
  weekStart:string;
  minutes:number;
  capacity:number;
  /** Full short-opening days and other indivisible assignments stay fixed. */
  locked:boolean;
}

export interface CycleWorkloadQuality {
  longDays:number;
  aboveNineMinutes:number;
  aboveEightMinutes:number;
}

const PREFERRED=480;
const LONG=540;
const STEP=15;
const IDEAL_WEEK=2400;
/** Bounded search policy, not a hard employment rule or user setting. */
const SOFT_WEEK_SPREAD=240;
const MAX_STEPS=100;

const countQuality=(entries:readonly CycleWorkday[]):CycleWorkloadQuality=>
  entries.reduce((q,e)=>({
    longDays:q.longDays+(e.minutes>LONG?1:0),
    aboveNineMinutes:q.aboveNineMinutes+Math.max(0,e.minutes-LONG),
    aboveEightMinutes:q.aboveEightMinutes+Math.max(0,e.minutes-PREFERRED),
  }),{longDays:0,aboveNineMinutes:0,aboveEightMinutes:0});

const compare=(a:CycleWorkloadQuality,b:CycleWorkloadQuality):number=>
  a.longDays-b.longDays ||
  a.aboveNineMinutes-b.aboveNineMinutes ||
  a.aboveEightMinutes-b.aboveEightMinutes;

/**
 * Value-only API: inputs are not mutated. Returns the unchanged original
 * allocation when a complete 28-day, exactly-160h opportunity is absent.
 * Never calls a database or requires adjacent-month data.
 */
export function optimize28DayWorkload(
  input:readonly CycleWorkday[],
  cycleTargetMinutes=9600,
):CycleWorkday[] {
  const days=input.map(e=>({...e}));
  const weeks=[...new Set(days.map(d=>d.weekStart))].sort();
  const dates=new Set(days.map(d=>d.date));
  if(weeks.length!==4 || days.length===0 ||
    dates.size!==days.length ||
    weeks.some((week,i)=>i>0&&week!==addCivilDays(weeks[i-1],7)) ||
    days.some(d=>!Number.isSafeInteger(d.minutes) ||
      !Number.isSafeInteger(d.capacity) ||
      d.minutes<=0 || d.capacity<d.minutes ||
      d.date<d.weekStart || d.date>=addCivilDays(d.weekStart,7) ||
      !Number.isSafeInteger(d.minutes/STEP) ||
      !Number.isSafeInteger(d.capacity/STEP)) ||
    days.reduce((sum,d)=>sum+d.minutes,0)!==cycleTargetMinutes)
    return days;
  const weekIndex=new Map(weeks.map((week,i)=>[week,i]));
  const totals=weeks.map(week=>days.filter(day=>day.weekStart===week)
    .reduce((sum,day)=>sum+day.minutes,0));
  const floors=totals.map(total=>Math.min(total,IDEAL_WEEK-SOFT_WEEK_SPREAD));
  const ceilings=totals.map(total=>Math.max(total,IDEAL_WEEK+SOFT_WEEK_SPREAD));
  const indices=days.map(day=>weekIndex.get(day.weekStart)??-1);
  if(indices.some(i=>i<0))return days;

  // A strict lexicographic improvement is required at EVERY whole move.
  // A move may need two receiving days to cross the 9h threshold without
  // creating a new long day. A single 15m-only hill-climber misses this.
  for(let step=0;step<MAX_STEPS;step++){
    const baseline=countQuality(days);
    let best:{
      from:number;toA:number;toB:number;
      a:number;b:number;quality:CycleWorkloadQuality;
      weekPenalty:number;
    }|null=null;
    for(let from=0;from<days.length;from++){
      const donor=days[from];
      if(donor.locked || donor.minutes<=LONG)continue;
      const amount=donor.minutes-LONG;
      if(amount>120 || amount%STEP!==0)continue;
      const donorWeek=indices[from];
      if(totals[donorWeek]-amount<floors[donorWeek])continue;
      for(let toA=0;toA<days.length;toA++){
        const receiver=days[toA];
        if(toA===from || receiver.locked || receiver.minutes===0)continue;
        if(indices[toA]===donorWeek)continue;
        const free=receiver.capacity-receiver.minutes;
        for(let a=STEP;a<=Math.min(amount,free);a+=STEP){
          const remainder=amount-a;
          if(remainder===0){
            if(totals[indices[toA]]+a>ceilings[indices[toA]])continue;
            const quality=countQualityWithChanges(days,baseline,[
              [from,donor.minutes-amount],
              [toA,receiver.minutes+a],
            ]);
            if(quality.aboveNineMinutes>baseline.aboveNineMinutes ||
              quality.aboveEightMinutes>baseline.aboveEightMinutes ||
              compare(quality,baseline)>=0)continue;
            const weekPenalty=weeklyDeviation(totals,indices,
              donorWeek,amount,toA,a,-1,0);
            if(!best || compare(quality,best.quality)<0 ||
              (compare(quality,best.quality)===0 &&
                weekPenalty<best.weekPenalty))
              best={from,toA,toB:-1,a,b:0,quality,weekPenalty};
            continue;
          }
          for(let toB=toA+1;toB<days.length;toB++){
            if(toB===from || days[toB].locked ||
              days[toB].minutes===0 ||
              days[toB].capacity-days[toB].minutes<remainder)continue;
            const weekA=indices[toA],weekB=indices[toB];
            if(weekA===weekB &&
              totals[weekA]+amount>ceilings[weekA])continue;
            if(weekA!==weekB &&
              (totals[weekA]+a>ceilings[weekA] ||
               totals[weekB]+remainder>ceilings[weekB]))continue;
            const quality=countQualityWithChanges(days,baseline,[
              [from,donor.minutes-amount],
              [toA,receiver.minutes+a],
              [toB,days[toB].minutes+remainder],
            ]);
            if(quality.aboveNineMinutes>baseline.aboveNineMinutes ||
              quality.aboveEightMinutes>baseline.aboveEightMinutes ||
              compare(quality,baseline)>=0)continue;
            const weekPenalty=weeklyDeviation(totals,indices,
              donorWeek,amount,toA,a,toB,remainder);
            if(!best || compare(quality,best.quality)<0 ||
              (compare(quality,best.quality)===0 &&
                weekPenalty<best.weekPenalty))
              best={from,toA,toB,a,b:remainder,quality,weekPenalty};
          }
        }
      }
    }
    if(!best)break;
    const donorWeek=indices[best.from];
    const moving=best.a+best.b;
    days[best.from].minutes-=moving;
    days[best.toA].minutes+=best.a;
    totals[donorWeek]-=moving;
    totals[indices[best.toA]]+=best.a;
    if(best.toB>=0){
      days[best.toB].minutes+=best.b;
      totals[indices[best.toB]]+=best.b;
    }
  }
  return days;
}

function countQualityWithChanges(
  days:readonly CycleWorkday[],
  baseline:CycleWorkloadQuality,
  changes:readonly (readonly [number,number])[],
):CycleWorkloadQuality {
  const q={...baseline};
  for(const [index,value] of changes){
    const old=days[index].minutes;
    q.longDays+=(value>LONG?1:0)-(old>LONG?1:0);
    q.aboveNineMinutes+=Math.max(0,value-LONG)-Math.max(0,old-LONG);
    q.aboveEightMinutes+=Math.max(0,value-PREFERRED)-Math.max(0,old-PREFERRED);
  }
  return q;
}

function weeklyDeviation(
  totals:readonly number[],indices:readonly number[],donorWeek:number,
  taken:number,toA:number,a:number,toB:number,b:number,
):number {
  const after=[...totals];
  after[donorWeek]-=taken;
  after[indices[toA]]+=a;
  if(toB>=0)after[indices[toB]]+=b;
  return after.reduce((sum,value)=>sum+(value-IDEAL_WEEK)**2,0);
}

export function measure28DayWorkload(
  days:readonly CycleWorkday[],
):CycleWorkloadQuality {
  return countQuality(days);
}
