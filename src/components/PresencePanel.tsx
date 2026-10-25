import type {
  OperatingHoursException,
  Person,
  PersonAvailability,
  PresenceException,
  PresenceRequirement,
  Weekday,
  WeeklyOperatingHours,
  WeeklyPresenceRequirements,
} from "../types";
import { getOperatingIntervalsForDate, getWeekday, WEEKDAYS } from "../utils/operatingCalendar";
import {
  checkPresenceAvailabilityCapacity,
  getPresencePhaseWindows,
  isPresenceRequirementValid,
} from "../utils/presence";
import { getAvailabilityIntervalsForDate } from "../utils/availability";

interface PresencePanelProps {
  weeklyOperatingHours: WeeklyOperatingHours;
  operatingExceptions: OperatingHoursException[];
  people: Person[];
  availabilities: PersonAvailability[];
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
    label: "Período central",
    help: "Mínimo obrigatório entre o fim da abertura e o início do fecho",
  },
  {
    key: "minimumAtOpening",
    label: "Na abertura",
    help: "Presentes durante os primeiros 30 minutos de funcionamento",
  },
  {
    key: "minimumAtClosing",
    label: "No fecho",
    help: "Presentes durante os últimos 30 minutos de funcionamento",
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

function phaseWindowsDescription(
  intervals: WeeklyOperatingHours[Weekday]
): string | null {
  const windows = getPresencePhaseWindows(intervals);
  if (!windows) return null;
  const describe = (ranges: typeof windows.opening) =>
    ranges.length > 0
      ? ranges.map((interval) => `${interval.start}–${interval.end}`).join(" · ")
      : "—";
  return `Abertura: ${describe(windows.opening)} | Centro: ${describe(windows.central)} | Fecho: ${describe(windows.closing)}`;
}

export default function PresencePanel({
  weeklyOperatingHours,
  operatingExceptions,
  people,
  availabilities,
  weeklyRequirements,
  exceptions,
  onWeeklyChange,
  onExceptionsChange,
}: PresencePanelProps) {
  const activePeople = people.filter((person) => person.active);
  const availabilityById = new Map(
    availabilities.map((availability) => [availability.personId, availability])
  );

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
          Os primeiros 30 minutos são a abertura e os últimos 30 minutos
          são o fecho. O restante funcionamento é o período central.
          Os três mínimos são independentes: 1 / 2 / 1 é válido.
          Em dias curtos, se abertura e fecho se sobrepuserem,
          aplica-se o mínimo mais exigente.
        </p>

        <div className="presence-week-grid">
          {WEEKDAYS.map((day) => {
            const closed = weeklyOperatingHours[day].length === 0;
            const requirement = weeklyRequirements[day];
            const valid = requirement !== null &&
              isPresenceRequirementValid(requirement);
            const capacity = valid
              ? checkPresenceAvailabilityCapacity(
                  weeklyOperatingHours[day],
                  requirement!,
                  activePeople.map((person) =>
                    availabilityById.get(person.id)?.weeklyAvailability[day] ?? []
                  )
                )
              : null;
            const shortage = capacity?.shortages[0];

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
                {!closed && (
                  <p className="presence-muted">
                    {phaseWindowsDescription(weeklyOperatingHours[day])}
                  </p>
                )}
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
                        Os três mínimos devem ser números inteiros não negativos.
                      </p>
                    )}
                    {shortage && (
                      <p className="presence-capacity-note">
                        Disponibilidade insuficiente entre
                        {" "}{shortage.interval.start}–{shortage.interval.end}:
                        {" "}{shortage.actual} elegíveis para
                        {" "}{shortage.required} necessários.
                        Verificação preliminar, não é uma simulação de turnos.
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
            Existem {invalidDays} dias com mínimos inválidos.
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
          Os períodos de abertura e fecho têm 30 minutos, tal como no padrão semanal.
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
              const capacity = validRequirement &&
                operatingIntervals !== null &&
                operatingIntervals.length > 0
                  ? checkPresenceAvailabilityCapacity(
                      operatingIntervals,
                      exception.requirements!,
                      activePeople.map((person) => {
                        const availability = availabilityById.get(person.id);
                        return availability
                          ? getAvailabilityIntervalsForDate(
                              exception.date, availability
                            )
                          : [];
                      })
                    )
                  : null;
              const shortage = capacity?.shortages[0];
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
                  {operatingIntervals !== null && operatingIntervals.length > 0 && (
                    <p className="presence-muted">
                      {phaseWindowsDescription(operatingIntervals)}
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
                            Os três mínimos devem ser números inteiros não negativos.
                          </p>
                        )}
                        {shortage && (
                          <p className="presence-capacity-note">
                            Disponibilidade insuficiente entre
                            {" "}{shortage.interval.start}–{shortage.interval.end}:
                            {" "}{shortage.actual} elegíveis para
                            {" "}{shortage.required} necessários.
                            Verificação preliminar.
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
        A verificação preliminar de disponibilidade só deteta
        insuficiências evidentes; não demonstra viabilidade de turnos.
        A validação integral será integrada no gerador.
      </p>
    </>
  );
}
