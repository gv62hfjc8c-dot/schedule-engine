/**
 * Pure, local, printable monthly PDF. No storage, network, or approvals.
 * A4 landscape, grouped by civil week. A missing shift is never a day off.
 * Built-in WinAnsi fonts support Portuguese/Western-Latin names.
 */
import {addCivilDays,civilDayOfWeek,resolvePlanningPeriod} from "./schedulePeriods";
import type {WorkAssignment} from "./workAssignments";
import type {PlannedRestWeekMember} from "./plannedRest";

export interface PrintableMember {id:string;name:string}
export type PrintableState="generated"|"edited"|"saved";
export type PrintableCertification="valid"|"invalid"|"insufficient_context"|"unknown";
export interface PrintableScheduleInput {
  year:number;month:number;
  companyName?:string;
  members:readonly PrintableMember[];
  assignments:readonly WorkAssignment[];
  plannedRest?:readonly PlannedRestWeekMember[];
  roles?:ReadonlyMap<string,string>;
  state:PrintableState;
  certification:PrintableCertification;
}
const ENCODER=new TextEncoder();
const WIDTH=842, HEIGHT=595, LEFT=26, RIGHT=816, MEMBER_WIDTH=145;
const DAYS=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const NORMAL=[0.13,0.19,0.29], MUTED=[0.38,0.45,0.55];
const NAVY=[0.07,0.20,0.32], PALE=[0.93,0.96,0.97], WHITE=[1,1,1];
function value(n:number){return n.toFixed(2);}
function rgb(c:readonly number[]){return c.map(value).join(" ");}
function hex(text:string):string {
  let output="";
  for(const char of text.normalize("NFC")){
    const n=char.codePointAt(0)!;
    const code=n>=32&&n<=126?n:n>=160&&n<=255?n:
      n===0x20ac?128:n===0x2013?150:n===0x2014?151:
      n===0x2018?145:n===0x2019?146:n===0x201c?147:
      n===0x201d?148:n===0x2026?133:63;
    output+=code.toString(16).padStart(2,"0").toUpperCase();
  }
  return output;
}
function shorten(text:string,max:number):string{
  const cleaned=text.replace(/\s+/gu," ").trim();
  const chars=Array.from(cleaned);
  return chars.length>max?chars.slice(0,max-3).join("")+"...":cleaned;
}
function textAt(x:number,y:number,label:string,size=9,bold=false,
  ink:readonly number[]=NORMAL):string{
  return rgb(ink)+" rg BT /"+(bold?"B":"R")+" "+value(size)+" Tf "+
    "1 0 0 1 "+value(x)+" "+value(y)+" Tm <"+hex(label)+"> Tj ET";
}
function box(x:number,y:number,w:number,h:number,fill:readonly number[]):string{
  return rgb(fill)+" rg "+value(x)+" "+value(y)+" "+
    value(w)+" "+value(h)+" re f";
}
function rule(x:number,y:number,toX:number,toY:number):string{
  return "0.77 0.81 0.85 RG 0.55 w "+value(x)+" "+value(y)+" m "+
    value(toX)+" "+value(toY)+" l S";
}
class Pdf {
  private readonly objs:string[]=[];
  reserve(){this.objs.push("");return this.objs.length;}
  add(value:string){const id=this.reserve();this.set(id,value);return id;}
  set(id:number,value:string){this.objs[id-1]=value;}
  finish(root:number):Uint8Array{
    const parts=["%PDF-1.4\n%Schedule Engine\n"],positions=[0];
    let offset=ENCODER.encode(parts[0]).length;
    for(let i=0;i<this.objs.length;i++){
      if(!this.objs[i])throw new Error("PDF incompleto.");
      positions.push(offset);
      const object=String(i+1)+" 0 obj\n"+this.objs[i]+"\nendobj\n";
      parts.push(object);offset+=ENCODER.encode(object).length;
    }
    const start=offset;
    parts.push("xref\n0 "+positions.length+"\n0000000000 65535 f \n");
    for(const position of positions.slice(1))
      parts.push(String(position).padStart(10,"0")+" 00000 n \n");
    parts.push("trailer\n<< /Size "+positions.length+" /Root "+
      root+" 0 R >>\nstartxref\n"+start+"\n%%EOF\n");
    return ENCODER.encode(parts.join(""));
  }
}
function label(state:PrintableState):string{
  return state==="saved"?"Rascunho guardado":
    state==="edited"?"Alterações por guardar":"Proposta não guardada";
}
function certificate(status:PrintableCertification):string{
  return status==="valid"?"Regras implementadas verificadas":
    status==="insufficient_context"?
      "Certificação incompleta: faltam semanas adjacentes":
    status==="invalid"?"Com conflitos: não certificado":
    "Certificação indisponível";
}
function dayTitle(date:string){
  return DAYS[civilDayOfWeek(date)]+" "+date.slice(8,10)+"/"+date.slice(5,7);
}
function memberNameLines(full:string):string[]{
  const words=full.trim().split(/\s+/u);
  const first:string[]=[],second:string[]=[];
  for(const word of words){
    if((first.join(" ")+" "+word).trim().length<=28&&!second.length)
      first.push(word);
    else second.push(word);
  }
  if(!first.length)return [shorten(full,29)];
  return second.length?[first.join(" "),shorten(second.join(" "),29)]:
    [first.join(" ")];
}
function roleName(id:string|undefined,roles:ReadonlyMap<string,string>|undefined){
  if(!id)return "Função não atribuída";
  return roles?.get(id)??(id==="checkout"?"Caixa":id==="sales"?"Vendas":id);
}
/** Produces a real PDF Uint8Array, without mutating inputs or saving them. */
export function createSchedulePdf(input:PrintableScheduleInput):Uint8Array{
  const period=resolvePlanningPeriod({mode:"monthly",year:input.year,month:input.month});
  const names=new Map(input.members.map(m=>[m.id,m.name]));
  const shifts=new Map<string,WorkAssignment[]>();
  for(const item of input.assignments){
    if(item.date<period.start||item.date>=period.endExclusive)continue;
    const key=item.memberId+"|"+item.date;
    const entries=shifts.get(key)??[];
    entries.push(item);shifts.set(key,entries);
    if(!names.has(item.memberId))
      names.set(item.memberId,"Colaborador "+item.memberId.slice(0,8));
  }
  if(names.size===0)throw new Error("Não existem colaboradores para imprimir.");
  const members=[...names].map(([id,name])=>({id,name})).sort((a,b)=>
    a.name.localeCompare(b.name,"pt-PT")||a.id.localeCompare(b.id));
  const planned=new Set<string>();
  for(const record of input.plannedRest??[])
    for(const day of record.daysWithoutWork)
      if(day>=period.start&&day<period.endExclusive)
        planned.add(record.memberId+"|"+day);
  const groups:PrintableMember[][]=[];
  for(let i=0;i<members.length;i+=10)groups.push(members.slice(i,i+10));
  const count=period.weeks.length*groups.length;
  const pdf=new Pdf(),root=pdf.reserve(),pages=pdf.reserve();
  const regular=pdf.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold=pdf.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const refs:number[]=[];
  const month=new Intl.DateTimeFormat("pt-PT",{month:"long",year:"numeric",timeZone:"UTC"})
    .format(new Date(Date.UTC(input.year,input.month-1,1)));
  let pageNumber=0;
  for(const week of period.weeks){
    const dates=Array.from({length:7},(_,i)=>addCivilDays(week.start,i));
    for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
      pageNumber++;
      const group=groups[groupIndex],ops:string[]=[];
      ops.push(box(0,0,WIDTH,HEIGHT,WHITE));
      ops.push(box(0,568,WIDTH,27,NAVY));
      ops.push(textAt(LEFT,577,shorten(input.companyName??"Schedule Engine",70),11,true,WHITE));
      ops.push(textAt(LEFT,545,"Horário de trabalho - "+month,17,true,NAVY));
      ops.push(textAt(LEFT,525,"Semana de "+dayTitle(dates[0])+
        " a "+dayTitle(dates[6]),10.2,true));
      ops.push(textAt(420,526,label(input.state),11,true,
        input.state==="saved"?NORMAL:[0.68,0.18,0.14]));
      ops.push(textAt(LEFT,507,certificate(input.certification),8.6,false,MUTED));
      ops.push(textAt(RIGHT-80,507,"Página "+pageNumber+"/"+count,8.6,false,MUTED));
      const top=492,heading=32,rowHeight=Math.min(45,360/group.length);
      const column=(RIGHT-LEFT-MEMBER_WIDTH)/7;
      ops.push(box(LEFT,top-heading,RIGHT-LEFT,heading,PALE));
      ops.push(textAt(LEFT+8,top-19,"Colaborador",9.3,true,NAVY));
      dates.forEach((date,i)=>{
        const current=date>=period.start&&date<period.endExclusive;
        ops.push(textAt(LEFT+MEMBER_WIDTH+i*column+7,
          top-19,dayTitle(date),9.3,true,current?NAVY:MUTED));
      });
      for(let row=0;row<group.length;row++){
        const bottom=top-heading-rowHeight*(row+1);
        if(row%2===1)ops.push(box(LEFT,bottom,RIGHT-LEFT,rowHeight,[0.975,0.980,0.987]));
        const member=group[row],lines=memberNameLines(member.name);
        ops.push(textAt(LEFT+7,bottom+rowHeight-17,lines[0],9.1,true,NAVY));
        if(lines[1])ops.push(textAt(LEFT+7,bottom+rowHeight-31,
          lines[1],8.5));
        for(let day=0;day<7;day++){
          const date=dates[day],x=LEFT+MEMBER_WIDTH+day*column+6;
          if(date<period.start||date>=period.endExclusive){
            ops.push(textAt(x,bottom+rowHeight-23,"-",9,false,MUTED));
            continue;
          }
          const key=member.id+"|"+date;
          const entries=shifts.get(key)??[];
          if(entries.length===0){
            ops.push(textAt(x,bottom+rowHeight-23,planned.has(key)?
              "Descanso planeado":"Sem turno",7.7,false,MUTED));
          }else if(entries.length>1){
            ops.push(textAt(x,bottom+rowHeight-17,
              String(entries.length)+" turnos",8.6,true,[0.68,0.18,0.14]));
            ops.push(textAt(x,bottom+rowHeight-30,"Verificar conflito",7.4,false,MUTED));
          }else{
            const shift=entries[0];
            ops.push(textAt(x,bottom+rowHeight-14,
              shift.start+"-"+shift.end,9,true));
            ops.push(textAt(x,bottom+rowHeight-27,
              shorten(roleName(shift.role,input.roles),19),8,false,MUTED));
            if(shift.mealBreak)
              ops.push(textAt(x,bottom+rowHeight-39,
                "P "+shift.mealBreak.start+"-"+shift.mealBreak.end,
                7.7,false,MUTED));
          }
        }
      }
      const bottom=top-heading-rowHeight*group.length;
      for(let row=0;row<=group.length;row++)
        ops.push(rule(LEFT,top-heading-row*rowHeight,
          RIGHT,top-heading-row*rowHeight));
      ops.push(rule(LEFT,top,RIGHT,top));
      for(let day=0;day<=7;day++){
        const x=LEFT+MEMBER_WIDTH+day*column;
        ops.push(rule(x,top,x,bottom));
      }
      ops.push(rule(LEFT,top,LEFT,bottom));
      ops.push(textAt(LEFT,60,
        "P = pausa para refeição. 'Sem turno' não significa folga.",8.2,false,MUTED));
      ops.push(textAt(LEFT,46,
        "Documento de planeamento. Não equivale a aprovação, registo de assiduidade ou certificação legal.",
        8.2,false,MUTED));
      if(groups.length>1)
        ops.push(textAt(RIGHT-145,60,
          "Equipa "+(groupIndex+1)+" de "+groups.length,8.2,false,MUTED));
      const stream=ops.join("\n")+"\n";
      const contentId=pdf.add("<< /Length "+ENCODER.encode(stream).length+
        " >>\nstream\n"+stream+"endstream");
      const page=pdf.add("<< /Type /Page /Parent "+pages+
        " 0 R /MediaBox [0 0 "+WIDTH+" "+HEIGHT+"] /Resources << /Font << "+
        "/R "+regular+" 0 R /B "+bold+" 0 R >> >> /Contents "+
        contentId+" 0 R >>");
      refs.push(page);
    }
  }
  pdf.set(pages,"<< /Type /Pages /Kids ["+refs.map(id=>id+" 0 R").join(" ")+
    "] /Count "+refs.length+" >>");
  pdf.set(root,"<< /Type /Catalog /Pages "+pages+" 0 R /Lang (pt-PT) >>");
  return pdf.finish(root);
}
export function schedulePdfFilename(year:number,month:number):string{
  resolvePlanningPeriod({mode:"monthly",year,month});
  return "horario-"+String(year).padStart(4,"0")+"-"+
    String(month).padStart(2,"0")+"-proposta.pdf";
}
