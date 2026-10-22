import {
  createEmptyWeeklyCoverage,
  getCoverageGaps,
  getCoverageGapsForDate,
  getRequiredPeopleAt,
  getRequiredPeopleForOperationAt,
  hasOverlappingCoverage,
  isCoverageRequirementWithinOperation,
  setWeeklyCoverage,
} from "./utils/coverage";

let weeklyCoverage = createEmptyWeeklyCoverage();

weeklyCoverage = setWeeklyCoverage(
  weeklyCoverage,
  "monday",
  [
    {
      start: "09:00",
      end: "12:00",
      minimumPeople: 2,
    },
    {
      start: "12:00",
      end: "14:00",
      minimumPeople: 3,
    },
    {
      start: "14:00",
      end: "18:00",
      minimumPeople: 2,
    },
  ]
);

if (
  getRequiredPeopleAt(
    "2026-10-26",
    "13:00",
    weeklyCoverage,
    []
  ) !== 3
) {
  throw new Error("Cobertura às 13:00 deveria ser 3");
}

if (
  getRequiredPeopleAt(
    "2026-10-27",
    "13:00",
    weeklyCoverage,
    []
  ) !== null
) {
  throw new Error(
    "Cobertura não configurada deveria devolver null"
  );
}

if (
  !isCoverageRequirementWithinOperation(
    {
      start: "10:00",
      end: "12:00",
      minimumPeople: 2,
    },
    [{ start: "09:00", end: "18:00" }]
  )
) {
  throw new Error(
    "Requisito dentro da operação deveria ser válido"
  );
}

if (
  isCoverageRequirementWithinOperation(
    {
      start: "08:00",
      end: "10:00",
      minimumPeople: 2,
    },
    [{ start: "09:00", end: "18:00" }]
  )
) {
  throw new Error(
    "Cobertura fora da operação deveria ser inválida"
  );
}

if (
  !hasOverlappingCoverage([
    {
      start: "09:00",
      end: "13:00",
      minimumPeople: 2,
    },
    {
      start: "12:00",
      end: "18:00",
      minimumPeople: 3,
    },
  ])
) {
  throw new Error(
    "Sobreposição de cobertura deveria ser detetada"
  );
}

const gaps = getCoverageGaps(
  [{ start: "09:00", end: "18:00" }],
  [
    {
      start: "09:00",
      end: "12:00",
      minimumPeople: 2,
    },
    {
      start: "14:00",
      end: "18:00",
      minimumPeople: 2,
    },
  ]
);

if (
  gaps.length !== 1 ||
  gaps[0]?.start !== "12:00" ||
  gaps[0]?.end !== "14:00"
) {
  throw new Error(
    "Deveria detetar o período 12:00–14:00 sem cobertura"
  );
}

const weeklyOperatingHours = {
  monday: [{ start: "09:00", end: "18:00" }],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const dateGaps = getCoverageGapsForDate(
  "2026-10-26",
  weeklyCoverage,
  [],
  weeklyOperatingHours,
  []
);

if (dateGaps.length !== 0) {
  throw new Error(
    "Segunda deveria ter cobertura operacional completa"
  );
}

const exceptionGaps = getCoverageGapsForDate(
  "2026-10-27",
  weeklyCoverage,
  [
    {
      date: "2026-10-27",
      requirements: [
        {
          start: "10:00",
          end: "12:00",
          minimumPeople: 1,
        },
      ],
    },
  ],
  weeklyOperatingHours,
  [
    {
      date: "2026-10-27",
      intervals: [{ start: "10:00", end: "14:00" }],
    },
  ]
);

if (
  exceptionGaps.length !== 1 ||
  exceptionGaps[0]?.start !== "12:00" ||
  exceptionGaps[0]?.end !== "14:00"
) {
  throw new Error(
    "Exceções de cobertura deveriam respeitar a operação efetiva"
  );
}

const staleTuesdayCoverage = setWeeklyCoverage(
  weeklyCoverage,
  "tuesday",
  [
    {
      start: "10:00",
      end: "12:00",
      minimumPeople: 4,
    },
  ]
);

if (
  getRequiredPeopleForOperationAt(
    "2026-10-27",
    "11:00",
    staleTuesdayCoverage,
    [],
    weeklyOperatingHours,
    []
  ) !== null
) {
  throw new Error(
    "Não deve existir cobertura efetiva quando a operação está fechada"
  );
}

if (
  getRequiredPeopleForOperationAt(
    "2026-10-26",
    "13:00",
    weeklyCoverage,
    [],
    weeklyOperatingHours,
    []
  ) !== 3
) {
  throw new Error(
    "Cobertura efetiva deveria respeitar operação e configuração"
  );
}

console.log("Coverage V0: todos os testes passaram.");
