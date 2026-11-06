import type {
  OperatingCalendarConfiguration, Person, PersonAvailability,
} from "./types";
import { createEmptyWeeklyAvailability } from "./utils/availability";
import { WEEKDAYS } from "./utils/operatingCalendar";
import {
  dayKind, dailyTeamRows, daySummary, effectiveShiftMinutes, filterDailyTeam,
  monthCalendarDates, monthStart, moveCalendarMonth, proposalCovers,
  todayInTimeZone, toggleFilteredSelection,
  type SchedulePreview,
} from "./utils/monthlyScheduleView";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error("PR45: " + message);
}
const monday = "2026-11-02", tuesday = "2026-11-03", sunday = "2026-11-08";
const operation: OperatingCalendarConfiguration = {
  weeklyOperatingHours: Object.fromEntries(WEEKDAYS.map(day => [
    day, day === "sunday" ? [] : [{start:"09:00",end:"18:00"}],
  ])) as OperatingCalendarConfiguration["weeklyOperatingHours"],
  exceptions: [],
};
const people: Person[] = Array.from({length:37},(_,i)=>({
  id:"p"+(i+1),name:"Pessoa "+String(i+1).padStart(2,"0"),active:i!==36,
}));
const availabilities: PersonAvailability[] = people.map((person,i)=>({
  personId:person.id,weeklyAvailability:{
    ...createEmptyWeeklyAvailability(),
    monday:i<20?[{start:"09:00",end:"18:00"}]:[],
  },exceptions:[],
}));
const proposal: SchedulePreview = {
  startDate:monday,endDate:sunday,timeZone:"Atlantic/Azores",
  assignments:[
    {date:monday,personId:"p1",interval:{start:"09:00",end:"18:00"},
      mealBreak:{start:"13:00",end:"14:00"}},
    {date:monday,personId:"p2",interval:{start:"10:00",end:"18:00"},
      mealBreak:{start:"13:00",end:"14:00"}},
  ],
};

const nov=monthCalendarDates("2026-11-10");
assert(nov.length===42&&nov[0]==="2026-10-26"&&nov[nov.length-1]==="2026-12-06",
  "O mês inclui semanas completas, sem cortar dias entre meses.");
assert(monthCalendarDates("2026-12-15").length===35,
  "O mês de dezembro deve ocupar cinco linhas.");
assert(monthCalendarDates("2027-02-10").length===28,
  "Um mês alinhado de 28 dias não precisa de linhas falsas.");
assert(monthStart("2026-11-25")==="2026-11-01" &&
  moveCalendarMonth("2026-12-01",1)==="2027-01-01" &&
  moveCalendarMonth("2027-01-01",-1)==="2026-12-01",
  "Navegar meses, inclusive mudança de ano.");
assert(todayInTimeZone("Atlantic/Azores",new Date("2026-11-06T00:30:00Z"))==="2026-11-05",
  "O dia atual deve respeitar o fuso da aplicação, não o do navegador.");

assert(dayKind(monday,operation,proposal)==="proposal", "Proposta visível no calendário.");
assert(dayKind(tuesday,operation,proposal)==="proposal",
  "Dia sem turno mas incluído no período continua a ser proposta.");
assert(dayKind(sunday,operation,proposal)==="closed",
  "O calendário operacional fechado tem precedência sobre uma proposta.");
assert(dayKind("2026-11-09",operation,proposal)==="unplanned",
  "Uma proposta não pode ser inventada fora do seu período.");
assert(!proposalCovers(proposal,"2026-11-09")&&proposalCovers(proposal,tuesday),
  "Intervalos de proposta verificados pelo dia civil.");

const rows=dailyTeamRows({date:monday,people,availabilities,operation,preview:proposal});
const total=daySummary(rows);
assert(total.total===36&&total.assigned===2&&total.available===18&&
  total.unavailable===16&&total.unplanned===0,
  "O resumo deve distinguir escalados, disponíveis e sem disponibilidade.");
assert(rows[0].id==="p1"&&rows[1].id==="p2"&&
  rows.every(r=>r.id!=="p37"),"Ordenação estável e só equipa ativa.");
assert(effectiveShiftMinutes(rows[0].shift!)===480,
  "Horas efetivas excluem refeição.");
assert(filterDailyTeam(rows,"assigned","",new Set()).length===2,
  "Filtro de escalados usa somente turnos reais da proposta.");
assert(filterDailyTeam(rows,"unavailable","",new Set()).length===16,
  "Não confundir falta de disponibilidade com ausência registada.");
assert(filterDailyTeam(rows,"all","PESSOA 02",new Set()).length===1,
  "Pesquisa case-insensitive em português.");

const noProposal=dailyTeamRows({
  date:"2026-11-09",people,availabilities,operation,preview:proposal,
});
assert(daySummary(noProposal).unplanned===36&&
  noProposal.every(r=>r.kind==="unplanned"&&r.shift===null),
  "Sem proposta não inferir folga, ausência ou turno.");
const closed=dailyTeamRows({date:sunday,people,availabilities,operation,preview:proposal});
assert(closed.every(r=>r.kind==="unplanned"),
  "Dia encerrado não deve aparecer como indisponibilidade da pessoa.");

let selected=new Set<string>(["p1"]);
selected=toggleFilteredSelection(selected,["p21","p22","p23"]);
assert(selected.size===4&&selected.has("p1")&&selected.has("p23"),
  "Selecionar pessoas noutro filtro não perde as selecionadas anteriormente.");
selected=toggleFilteredSelection(selected,["p21","p22","p23"]);
assert(selected.size===1&&selected.has("p1"),
  "Desmarcar filtrados não remove seleções fora do filtro.");
selected=toggleFilteredSelection(selected,rows.slice(0,24).map(row=>row.id));
assert(selected.size===24&&selected.has("p24"),
  "Seleção global do filtro abrange várias páginas e não só a página atual.");
assert(filterDailyTeam(rows,"selected","",selected).length===24,
  "É possível rever pessoas selecionadas entre páginas.");

console.log("PR45: calendário, estados honestos, equipa numerosa e seleção cruzada passaram.");
