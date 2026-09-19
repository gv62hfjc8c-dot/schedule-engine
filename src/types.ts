export type ShiftId = "A" | "B" | "C";

export interface Pessoa {
  id: string;
  nome: string;
  eligibleShiftIds?: ShiftId[];
}

export interface Shift {
  id: ShiftId;
  entry: string;
  lunchStart: string;
  lunchEnd: string;
  exit: string;
}

export interface ScheduleCell {
  shift: ShiftId;
}

export type Schedule = Record<string, ScheduleCell>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}