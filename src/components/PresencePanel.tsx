import type {
  OperatingHoursException,
  PresenceException,
  PresenceRequirement,
  Weekday,
  WeeklyOperatingHours,
  WeeklyPresenceRequirements,
} from "../types";
import { getOperatingIntervalsForDate, getWeekday, WEEKDAYS } from "../utils/operatingCalendar";
import { isPresenceRequirementValid } from "../utils/presence";

interface PresencePanelProps {
  weeklyOperatingHours: WeeklyOperatingHours;
  operatingExceptions: OperatingHoursException[];
  weeklyRequirements: WeeklyPresenceRequirements;
  exceptions: PresenceException[];
  onWeeklyChange: (next: WeeklyPresenceRequirements) => void;
  onExceptionsChange: (next: PresenceException[]) => void;
}

const labels: Record<Weekday, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

const emptyRequirement = (): PresenceRequirement => ({
  minimumDuringOperation: 0,
  minimumAtOpening: 0,
  minimumAtClosing: 0,
});

const fields: {
  key: keyof PresenceRequirement;
  label: string;
  help: string;
}[] = [
  {
    key: "minimumDuringOperation",
    label: "Durante a operação",
    help: "Mínimo garantido enquanto a empresa está aberta",
  },
  {
    key: "minimumAtOpening",
    label: "Na abertura",
    help: "Presentes no início da operação",
  },
  {
    key: "minimumAtClosing",
    label: "No fecho",
    help: "Presentes até ao fim da operação",
  },
];

function RequirementFields({
  requirement,
  onChange,
  prefix,
}: {
  requirement: PresenceRequirement;
  onChange: (next: PresenceRequirement) => void;
  prefix: string;
}) {
  return (
    <div className="presence-fields">
      {fields.map((field) => (
        <label className="presence-field" key={field.key}>
          <span title={field.help}>{field.label}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            aria-label={`${prefix}: ${field.label}`}
            value={requirement[field.key]}
            onChange={(event) => {
              const raw = event.target.value;
              const nextValue = raw === "" ? 0 : Number(raw);
              if (!Number.isSafeInteger(nextValue) || nextValue < 0) return;
              onChange({ ...requirement, [field.key]: nextValue });
            }}
          />
        </label>
      ))}
    </div>
  );
}

function nextFreeDate(exceptions: PresenceException[]): string {
  const dates = new Set(exceptions.map((item) => item.date));
  const now = new Date();
  const date = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate()
  ));

  while (dates.has(date.toISOString().slice(0, 10))) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString().slice(0, 10);
}

function safeOperationalIntervals(
  date: string,
  weeklyHours: WeeklyOperatingHours,
  operatingExceptions: OperatingHoursException[]
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  try {
    return getOperatingIntervalsForDate(date, weeklyHours, operatingExceptions);
  } catch {
    return null;
  }
}

export default function PresencePanel({
  weeklyOperatingHours,
  operatingExceptions,
  weeklyRequirements,
  exceptions,
  onWeeklyChange,
  onExceptionsChange,
}: PresencePanelProps) {
  const openDays = WEEKDAYS.filter(
    (day) => weeklyOperatingHours[day].length > 0
  );
  const configuredDays = openDays.filter(
    (day) => weeklyRequirements[day] !== null &&
      isPresenceRequirementValid(weeklyRequirements[day]!)
  ).length;
  const invalidDays = openDays.filter(
    (day) => weeklyRequirements[day] !== null &&
      !isPresenceRequirementValid(weeklyRequirements[day]!)
  ).length;

  const updateWeekly = (
    weekday: Weekday,
    requirement: PresenceRequirement | null
  ) => {
    onWeeklyChange({ ...weeklyRequirements, [weekday]: requirement });
  };

  const updateException = (index: number, next: PresenceException) => {
    onExceptionsChange(
      exceptions.map((item, currentIndex) =>
        currentIndex === index ? next : item
      )
    );
  };

  const addException = () => {
    const date = nextFreeDate(exceptions);
    const weekday = getWeekday(date);
    const defaultRequirement = weeklyRequirements[weekday];
    onExceptionsChange([
      ...exceptions,
      {
        date,
        requirements: defaultRequirement
          ? { ...defaultRequirement }
          : emptyRequirement(),
      },
    ]);
  };

  return (
    <>
      <section className="overview-bar" aria-label="Resumo de presença">
        <div className="overview-item">
          <span>Dias abertos</span>
          <strong>{openDays.length}</strong>
        </div>
        <div className="overview-item">
          <span>Dias com mínimos válidos</span>
          <strong>{configuredDays} / {openDays.length}</strong>
        </div>
        <div className="overview-item">
          <span>Por configurar / corrigir</span>
          <strong>{openDays.length - configuredDays}</strong>
        </div>
      </section>

      <section className="panel presence-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Ponto 5</p>
            <h2>Requisitos de presença</h2>
          </div>
          <p className="panel-help">
            Define mínimos obrigatórios, não quantidades exatas.
            O motor poderá colocar mais pessoas em simultâneo.
          </p>
        </div>
        <p className="section-description">
          Na abertura e no fecho, o mínimo não pode ser inferior
          ao mínimo durante a operação. Nenhum destes valores
          define um intervalo de maior afluência.
        </p>

        <div className="presence-week-grid">
          {WEEKDAYS.map((day) => {
            const closed = weeklyOperatingHours[day].length === 0;
            const requirement = weeklyRequirements[day];
            const valid = requirement !== null &&
              isPresenceRequirementValid(requirement);

            return (
              <article className={`presence-day ${closed ? "is-closed" : ""}`} key={day}>
                <div className="presence-day-head">
                  <div>
                    <strong>{labels[day]}</strong>
                    <span>
                      {closed
                        ? "Fechado"
                        : weeklyOperatingHours[day]
                            .map((interval) => `${interval.start}–${interval.end}`)
                            .join(" · ")}
                    </span>
                  </div>
                  {!closed && requirement !== null && (
                    <button
                      type="button"
                      className="presence-text-button"
                      onClick={() => updateWeekly(day, null)}
                      aria-label={`Retirar mínimos de ${labels[day]}`}
                    >
                      Limpar
                    </button>
                  )}
                </div>
                {closed ? (
                  <p className="presence-muted">
                    Sem presença exigida. A regra anterior, se existir, fica preservada.
                  </p>
                ) : requirement === null ? (
                  <div className="presence-unconfigured">
                    <p>Por configurar</p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => updateWeekly(day, emptyRequirement())}
                    >
                      Definir mínimos
                    </button>
                  </div>
                ) : (
                  <>
                    <RequirementFields
                      requirement={requirement}
                      onChange={(next) => updateWeekly(day, next)}
                      prefix={labels[day]}
                    />
                    {!valid && (
                      <p className="presence-validation" role="alert">
                        Abertura e fecho devem ser iguais ou superiores
                        ao mínimo durante a operação.
                      </p>
                    )}
                    {valid && requirement.minimumAtOpening === 0 &&
                      requirement.minimumDuringOperation === 0 &&
                      requirement.minimumAtClosing === 0 && (
                        <p className="presence-muted">
                          Mínimos explicitamente definidos como zero.
                        </p>
                      )}
                  </>
                )}
              </article>
            );
          })}
        </div>
        {invalidDays > 0 && (
          <p className="presence-validation" role="alert">
            Existem {invalidDays} dias com mínimos incoerentes.
          </p>
        )}
      </section>

      <section className="panel presence-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Datas específicas</p>
            <h2>Exceções</h2>
          </div>
          <button className="primary-button" type="button" onClick={addException}>
            <span>+</span> Adicionar
          </button>
        </div>
        <p className="section-description">
          Cada exceção substitui a regra semanal nessa data.
          Em datas fechadas não se aplica qualquer mínimo.
        </p>

        {exceptions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <strong>Sem exceções de presença</strong>
            <p>Aplicam-se os mínimos definidos para o dia da semana.</p>
          </div>
        ) : (
          <div className="presence-exceptions">
            {exceptions.map((exception, index) => {
              const operatingIntervals = safeOperationalIntervals(
                exception.date, weeklyOperatingHours, operatingExceptions
              );
              const duplicate = exceptions.some(
                (item, candidateIndex) =>
                  candidateIndex !== index && item.date === exception.date
              );
              const closed = operatingIntervals?.length === 0;
              const validRequirement = exception.requirements !== null &&
                isPresenceRequirementValid(exception.requirements);
              return (
                <article className="presence-exception" key={index}>
                  <div className="presence-exception-top">
                    <label className="select-field">
                      <span>Data</span>
                      <input
                        className="date-input"
                        type="date"
                        value={exception.date}
                        onChange={(event) =>
                          updateException(index, {
                            ...exception,
                            date: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onExceptionsChange(
                        exceptions.filter((_, candidateIndex) => candidateIndex !== index)
                      )}
                      aria-label="Remover exceção de presença"
                    >
                      ×
                    </button>
                  </div>

                  {duplicate && (
                    <p className="presence-validation" role="alert">
                      Já existe uma exceção nesta data.
                    </p>
                  )}
                  {operatingIntervals === null && (
                    <p className="presence-validation" role="alert">
                      Introduz uma data válida.
                    </p>
                  )}
                  {closed && (
                    <p className="presence-muted">
                      A operação está fechada nesta data. Os requisitos não se aplicam.
                    </p>
                  )}
                  {!closed && operatingIntervals !== null && (
                    exception.requirements === null ? (
                      <div className="presence-unconfigured">
                        <p>Exceção sem mínimos configurados.</p>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => updateException(index, {
                            ...exception,
                            requirements: emptyRequirement(),
                          })}
                        >
                          Definir mínimos
                        </button>
                      </div>
                    ) : (
                      <>
                        <RequirementFields
                          requirement={exception.requirements}
                          onChange={(next) => updateException(index, {
                            ...exception, requirements: next,
                          })}
                          prefix={`Exceção ${exception.date}`}
                        />
                        {!validRequirement && (
                          <p className="presence-validation" role="alert">
                            Abertura e fecho não podem ficar abaixo do mínimo operacional.
                          </p>
                        )}
                        <button
                          className="presence-text-button"
                          type="button"
                          onClick={() => updateException(index, {
                            ...exception, requirements: null,
                          })}
                        >
                          Deixar por configurar
                        </button>
                      </>
                    )
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <p className="presence-disclaimer">
        Configurar mínimos não significa que já exista um horário viável.
        A verificação de disponibilidades, regras de trabalho e
        atribuições concretas será integrada no gerador.
      </p>
    </>
  );
}
