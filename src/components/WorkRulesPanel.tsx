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

  const configured =
    isValidShiftDurationMinutes(duration);

  const durationHours = configured
    ? duration / 60
    : "";

  const setDurationHours = (
    rawValue: string
  ) => {
    if (rawValue.trim() === "") {
      onChange({
        standardShiftDurationMinutes: null,
      });
      return;
    }

    const hours = Number(rawValue);

    if (!Number.isFinite(hours) || hours <= 0) {
      return;
    }

    onChange({
      standardShiftDurationMinutes:
        Math.round(hours * 60),
    });
  };

  const openDays = WEEKDAYS.filter(
    (weekday) =>
      weeklyOperatingHours[weekday].length > 0
  );

  const compatibleDays = configured
    ? openDays.filter((weekday) => {
        const intervals =
          weeklyOperatingHours[weekday];

        return (
          createOpeningShift(
            intervals,
            duration
          ) !== null &&
          createClosingShift(
            intervals,
            duration
          ) !== null
        );
      })
    : [];

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
              ? formatDuration(duration)
              : "Não configurada"}
          </strong>
        </div>

        <div className="overview-item">
          <span>Tipo de turno</span>
          <strong>Contínuo</strong>
        </div>

        <div className="overview-item">
          <span>Dias compatíveis</span>
          <strong>
            {configured
              ? `${compatibleDays.length} / ${openDays.length}`
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
                  Esta duração será usada para construir
                  turnos de abertura, intermédios e fecho.
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
                    duration
                  );
                const closing =
                  createClosingShift(
                    intervals,
                    duration
                  );

                const compatible =
                  opening !== null &&
                  closing !== null;

                return (
                  <div
                    className={`work-preview-row ${compatible ? "" : "is-invalid"}`}
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

                    {compatible ? (
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
                    ) : (
                      <span className="work-preview-warning">
                        A duração não cabe num período
                        contínuo de funcionamento.
                      </span>
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
