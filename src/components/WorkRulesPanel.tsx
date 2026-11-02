import type {
  WeeklyOperatingHours,
  WorkRulesConfiguration,
} from "../types";
import {
  createClosingShift,
  createOpeningShift,
  isValidShiftDurationMinutes,
} from "../utils/workRules";
import {
  WEEKDAYS,
} from "../utils/operatingCalendar";

interface WorkRulesPanelProps {
  weeklyOperatingHours: WeeklyOperatingHours;
  workRules: WorkRulesConfiguration;
  onChange: (rules: WorkRulesConfiguration) => void;
}

const weekdayLabels = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
} as const;

function formatDuration(
  durationMinutes: number
): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

export default function WorkRulesPanel({
  weeklyOperatingHours,
  workRules,
  onChange,
}: WorkRulesPanelProps) {
  const duration =
    workRules.standardShiftDurationMinutes;
  const maximumHours = (workRules.maximumDailyEffectiveMinutes ?? 480) / 60;

  const validDuration =
    isValidShiftDurationMinutes(duration)
      ? duration
      : null;
  const configured = validDuration !== null;
  const durationForPreview =
    validDuration ?? 0;

  const durationHours =
    validDuration !== null
      ? validDuration / 60
      : "";

  const setDurationHours = (
    rawValue: string
  ) => {
    if (rawValue.trim() === "") {
      onChange({
        ...workRules,
        standardShiftDurationMinutes: null,
      });
      return;
    }

    const hours = Number(rawValue);

    if (!Number.isFinite(hours) || hours <= 0) {
      return;
    }

    onChange({
      ...workRules,
      standardShiftDurationMinutes:
        Math.round(hours * 60),
    });
  };

  const openDays = WEEKDAYS.filter(
    (weekday) =>
      weeklyOperatingHours[weekday].length > 0
  );

  const shortenedDays = configured
    ? openDays.filter((weekday) => {
        const intervals =
          weeklyOperatingHours[weekday];
        const opening = createOpeningShift(
          intervals,
          durationForPreview
        );

        if (!opening) return false;

        const [startHours, startMinutes] =
          opening.start.split(":").map(Number);
        const [endHours, endMinutes] =
          opening.end.split(":").map(Number);

        return (
          endHours * 60 +
            endMinutes -
            (startHours * 60 + startMinutes) <
          durationForPreview
        );
      }).length
    : 0;

  return (
    <>
      <section
        className="overview-bar"
        aria-label="Resumo das regras de trabalho"
      >
        <div className="overview-item">
          <span>Duração padrão</span>
          <strong>
            {configured
              ? formatDuration(durationForPreview)
              : "Não configurada"}
          </strong>
        </div>

        <div className="overview-item">
          <span>Tipo de turno</span>
          <strong>Contínuo</strong>
        </div>

        <div className="overview-item">
          <span>Dias ajustados</span>
          <strong>
            {configured
              ? shortenedDays
              : "—"}
          </strong>
        </div>
      </section>

      <div className="work-rules-layout">
        <section className="panel work-rules-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">
                Ponto 4
              </p>
              <h2>Regras de trabalho</h2>
            </div>
            <p className="panel-help">
              Define a duração base de um período diário
              contínuo de trabalho.
            </p>
          </div>

          <div className="work-rules-content">
            <div className="work-rule-card">
              <div>
                <strong>
                  Duração padrão do turno
                </strong>
                <p>
                  Esta é a duração normal do turno. Se o
                  funcionamento do dia for mais curto, o
                  turno ajusta-se a esse período.
                </p>
              </div>

              <label className="work-duration-field">
                <span>Horas</span>
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  placeholder="Ex.: 8"
                  value={durationHours}
                  onChange={(event) =>
                    setDurationHours(
                      event.target.value
                    )
                  }
                />
              </label>
            </div>

            <div className="work-rule-card">
              <div>
                <strong>Máximo diário de trabalho efetivo</strong>
                <p>
                  Limite obrigatório por empresa, distinto da duração padrão.
                  A pausa de refeição não conta como trabalho efetivo.
                </p>
              </div>
              <label className="work-duration-field">
                <span>Horas</span>
                <input
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={maximumHours}
                  onChange={(event) => {
                    const hours = Number(event.target.value);
                    if (Number.isFinite(hours) && hours >= 0.25 && hours <= 24) {
                      onChange({
                        ...workRules,
                        maximumDailyEffectiveMinutes: Math.round(hours * 60),
                      });
                    }
                  }}
                />
              </label>
            </div>

            <div className="work-rule-card">
              <div>
                <strong>Jornada integral em dias curtos</strong>
                <p>Se um dia tiver até esta duração de funcionamento, quem for escalado cumpre todo o período. Por exemplo, 5h para domingos das 14:00 às 19:00. Introduz 0 para desativar.</p>
              </div>
              <label className="work-duration-field">
                <span>Até (horas)</span>
                <input type="number" min="0" max="24" step="0.25"
                  value={(workRules.fullShortDayMaximumMinutes ?? 0)/60}
                  onChange={(event) => {
                    const hours=Number(event.target.value);
                    if(Number.isFinite(hours)&&hours>=0&&hours<=24)
                      onChange({...workRules,fullShortDayMaximumMinutes:Math.round(hours*60)});
                  }} />
              </label>
            </div>
            <div className="work-rule-card">
              <div>
                <strong>Dias disponíveis são dias de trabalho</strong>
                <p>
                  Quando ativado, cada dia aberto com disponibilidade escalável
                  requer um turno para essa pessoa. Folgas e indisponibilidades
                  mantêm-se obrigatórias. Se não for possível cumprir todos os
                  dias e limites, o motor não publica uma solução como válida.
                  Desativado, a disponibilidade significa apenas que pode trabalhar.
                </p>
              </div>
              <label className="work-duration-field">
                <span>Obrigatório</span>
                <input type="checkbox"
                  checked={workRules.requireShiftsOnAvailableDays ?? false}
                  onChange={(event) => onChange({
                    ...workRules,
                    requireShiftsOnAvailableDays: event.target.checked,
                  })}
                />
              </label>
            </div>
            <div className="work-rule-card">
              <div>
                <strong>Turnos contínuos</strong>
                <p>
                  Uma pessoa trabalha um único intervalo
                  contínuo por dia. Turnos repartidos não
                  fazem parte deste modelo.
                </p>
              </div>

              <span className="work-rule-badge">
                Regra estrutural
              </span>
            </div>
          </div>
        </section>

        <aside className="panel work-preview-panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">
                Pré-visualização
              </p>
              <h2>Abertura e fecho</h2>
            </div>
          </div>

          {!configured ? (
            <div className="empty-state">
              <div className="empty-icon">◎</div>
              <strong>
                Define primeiro a duração
              </strong>
              <p>
                O motor ainda não deve assumir uma duração
                de turno.
              </p>
            </div>
          ) : (
            <div className="work-preview-list">
              {WEEKDAYS.map((weekday) => {
                const intervals =
                  weeklyOperatingHours[weekday];

                if (intervals.length === 0) {
                  return (
                    <div
                      className="work-preview-row is-closed"
                      key={weekday}
                    >
                      <strong>
                        {weekdayLabels[weekday]}
                      </strong>
                      <span>Empresa fechada</span>
                    </div>
                  );
                }

                const opening =
                  createOpeningShift(
                    intervals,
                    durationForPreview
                  );
                const closing =
                  createClosingShift(
                    intervals,
                    durationForPreview
                  );

                if (!opening || !closing) {
                  return (
                    <div
                      className="work-preview-row"
                      key={weekday}
                    >
                      <div className="work-preview-day">
                        <strong>
                          {weekdayLabels[weekday]}
                        </strong>
                      </div>
                      <span className="work-preview-warning">
                        Não existe um período operacional
                        contínuo válido.
                      </span>
                    </div>
                  );
                }

                const sameShift =
                  opening.start === closing.start &&
                  opening.end === closing.end;

                return (
                  <div
                    className="work-preview-row"
                    key={weekday}
                  >
                    <div className="work-preview-day">
                      <strong>
                        {weekdayLabels[weekday]}
                      </strong>
                      <span>
                        Operação{" "}
                        {intervals
                          .map(
                            (interval) =>
                              `${interval.start}–${interval.end}`
                          )
                          .join(" · ")}
                      </span>
                    </div>

                    {sameShift ? (
                      <div className="work-preview-shifts is-single">
                        <span>
                          Turno do dia
                          <strong>
                            {opening.start}–
                            {opening.end}
                          </strong>
                        </span>
                      </div>
                    ) : (
                      <div className="work-preview-shifts">
                        <span>
                          Abre{" "}
                          <strong>
                            {opening.start}–
                            {opening.end}
                          </strong>
                        </span>
                        <span>
                          Fecha{" "}
                          <strong>
                            {closing.start}–
                            {closing.end}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="work-preview-note">
            Estes horários são apenas posições possíveis
            de abertura e fecho. Ainda não representam um
            horário gerado nem definem quantas pessoas
            devem ocupar cada posição.
          </p>
        </aside>
      </div>
    </>
  );
}
