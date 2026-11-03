import test from "node:test";
import assert from "node:assert/strict";
import { createChart, sampleInput, branches } from "../src/lib/chart";
import { chartForQuestion } from "../src/lib/ai";
import { timingEngine } from "../src/lib/fortune";
import {
  chartVariant,
  getHoroscope,
  listFortunePeriods,
  inspectChart,
  convertCalendar,
  EngineQueryError,
  executeEngineQuery,
} from "../src/lib/engine-query";
import {
  questionQueries,
  withFortuneDate,
  readingClock,
} from "../src/lib/reading-query";
const chart = createChart({ ...sampleInput, name: "PRIVATE_NAME" });
const now = new Date("2026-11-03T04:00:00Z");
const query = (args: Record<string, unknown>) =>
  getHoroscope(chart, args, now) as any;
const list = (args: Record<string, unknown>) =>
  listFortunePeriods(chart, args, now) as any;

test("all six time layers preserve the engine branch mapping and do not mutate the displayed chart", () => {
  const before = JSON.stringify(chart);
  const result = query({
    dates: ["2026-11-03"],
    scopes: ["decadal", "age", "yearly", "monthly", "daily", "hourly"],
    timeIndex: 4,
  });
  const raw = timingEngine(chart).raw;
  const original = raw.horoscope("2026-11-03", 4);
  assert.equal(result.periods[0].nominalAge, 32);
  for (const layer of result.periods[0].layers) {
    const native = original[layer.scope as keyof typeof original] as any;
    assert.equal(
      layer.lifePalaceBranch,
      raw.palaces[native.index].earthlyBranch,
    );
    assert.deepEqual(
      layer.fourTransformations.map((f: any) => f.star),
      native.mutagen,
    );
    assert.equal(layer.palaces.length, 12);
  }
  assert.equal(JSON.stringify(chart), before);
  assert.equal(
    result.periods[0].layers
      .find((l: any) => l.scope === "age")
      .palaces.flatMap((p: any) => p.transitStars).length,
    0,
  );
  assert.ok(result.periods[0].layers[0].interpretationLayer.includes("独立"));
});

test("late 子时 uses the next day consistently across the lunar year and all time layers", () => {
  const late = query({
    dates: ["2026-02-16"],
    scopes: ["age", "yearly", "monthly", "daily", "hourly"],
    timeIndex: 12,
  }).periods[0];
  const next = query({
    dates: ["2026-02-17"],
    scopes: ["age", "yearly", "monthly", "daily", "hourly"],
    timeIndex: 0,
  }).periods[0];
  assert.equal(late.effectiveDate, "2026-02-17");
  assert.equal(late.nominalAge, 32);
  assert.deepEqual(late.layers, next.layers);
  const before = query({ dates: ["2026-02-16"], scopes: ["age"] }).periods[0];
  assert.equal(before.nominalAge, 31);
});

test("2025 leap sixth month is split into two dated periods; Gregorian month queries cover both lunar years", () => {
  const result = list({ kind: "months", year: 2025, calendar: "lunar" });
  assert.equal(result.periods.length, 14);
  const leap = result.periods.filter((p: any) => p.isLeapMonth);
  assert.deepEqual(
    leap.map((p: any) => [p.month, p.part, p.startDate, p.endDate]),
    [
      [6, "first", "2025-07-25", "2025-08-08"],
      [6, "second", "2025-08-09", "2025-08-22"],
    ],
  );
  assert.notEqual(leap[0].lifePalaceBranch, leap[1].lifePalaceBranch);
  const first = query({ dates: ["2025-08-08"], scopes: ["monthly"] }).periods[0]
    .layers[0];
  const second = query({ dates: ["2025-08-09"], scopes: ["monthly"] })
    .periods[0].layers[0];
  assert.equal(first.lifePalaceBranch, leap[0].lifePalaceBranch);
  assert.equal(second.lifePalaceBranch, leap[1].lifePalaceBranch);
  const feb = list({
    kind: "months",
    year: 2026,
    month: 2,
    calendar: "solar",
  }).periods;
  assert.deepEqual(
    feb.map((p: any) => p.year),
    [2025, 2026],
  );
  assert.equal(feb[0].viewStart, "2026-02-01");
  assert.equal(feb.at(-1).viewEnd, "2026-02-28");
});

test("bounded time lists support decades, their ten years, consecutive days and all thirteen clock periods", () => {
  assert.equal(list({ kind: "decades" }).periods.length, 12);
  assert.equal(
    list({ kind: "decade_years", decadeIndex: 2 }).periods.length,
    10,
  );
  assert.equal(list({ kind: "years", year: 2030, count: 5 }).periods.length, 5);
  const days = list({
    kind: "days",
    startDate: "2026-12-29",
    count: 7,
  }).periods;
  assert.equal(days.at(-1).date, "2027-01-04");
  const hours = list({ kind: "hours", startDate: "2026-11-03" }).periods;
  assert.equal(hours.length, 13);
  assert.equal(hours[12].effectiveDate, "2026-11-04");
  assert.equal(
    list({ kind: "years", year: 1995, count: 1 }).periods[0].status,
    "available",
  );
});

test("pre-birth and out-of-range ages are explicit, not silently invented as current palaces", () => {
  assert.equal(
    query({ dates: ["1994-01-01"], scopes: ["age", "decadal"] }).periods[0]
      .status,
    "before_birth",
  );
  const old = createChart({ ...sampleInput, date: "1900-05-01" });
  const result = getHoroscope(
    old,
    { dates: ["2100-11-03"], scopes: ["age", "decadal"] },
    now,
  ) as any;
  assert.equal(
    result.periods[0].layers.every(
      (l: any) => l.status === "outside_calculated_range",
    ),
    true,
  );
  const young = createChart({ ...sampleInput, date: "2026-08-17" });
  const childhood = getHoroscope(
    young,
    { dates: ["2026-11-03"], scopes: ["decadal"] },
    now,
  ) as any;
  assert.equal(childhood.periods[0].layers[0].name, "童限");
});

test("palace analysis uses the displayed stars, true three-way/opposite/flanking branches, and empty palace references", () => {
  const empty = chart.palaces.find((p) => p.isEmpty)!;
  const r = inspectChart(
    chart,
    { palace: empty.name, view: "relationships", stars: ["紫微", "天府"] },
    now,
  ) as any;
  assert.deepEqual(
    r.surrounded.map((p: any) => p.branch),
    [0, 4, 6, 8].map((offset) => branches[(empty.branch + offset) % 12]),
  );
  assert.deepEqual(
    r.flanking.map((p: any) => p.branch),
    [11, 1].map((offset) => branches[(empty.branch + offset) % 12]),
  );
  assert.deepEqual(r.target.borrowedStars, empty.borrowedStars);
  assert.ok(r.target.isEmpty);
  const star = inspectChart(chart, { star: "太阴", view: "stars" }, now) as any;
  assert.equal(
    star.queriedStar.brightnessRaw,
    chart.palaces.flatMap((p) => p.stars).find((s) => s.name === "太阴")!
      .brightnessRaw,
  );
  const flying = inspectChart(
    chart,
    { palace: "命宫", view: "mutagens" },
    now,
  ) as any;
  assert.equal(flying.flights.length, 4);
  assert.equal(
    flying.selfTransformations.every((f: any) =>
      f.natalBranches.includes(flying.target.branch),
    ),
    true,
  );
  const aux = inspectChart(
    chart,
    { palace: "来因宫", view: "auxiliary" },
    now,
  ) as any;
  assert.ok(aux.isOriginalPalace);
  assert.equal(Object.keys(aux.auxiliaryStars).length, 4);
});

test("time palace queries resolve that time layer and retain natal and transit stars separately", () => {
  const r = inspectChart(
    chart,
    {
      palace: "命宫",
      scope: "monthly",
      date: "2026-11-03",
      stars: ["流禄"],
      view: "relationships",
    },
    now,
  ) as any;
  const native = timingEngine(chart).raw;
  assert.equal(
    r.target.branch,
    native.palaces[native.horoscope("2026-11-03", 0).monthly.index]
      .earthlyBranch,
  );
  assert.equal(r.target.scopePalace, "命宫");
  assert.equal(r.surrounded.length, 4);
  assert.ok(Array.isArray(r.target.transitStars));
  assert.ok(Array.isArray(r.checks.target.transitMatches));
});

test("calendar conversion round trips leap dates and rejects nonexistent days/leap months", () => {
  assert.deepEqual(
    convertCalendar({
      calendar: "lunar",
      date: "2025-06-16",
      isLeapMonth: true,
    }),
    {
      solar: "2025-08-09",
      lunar: { year: 2025, month: 6, day: 16, isLeapMonth: true },
    },
  );
  assert.equal(
    (convertCalendar({ calendar: "solar", date: "2025-08-09" }) as any).lunar
      .isLeapMonth,
    true,
  );
  for (const args of [
    { calendar: "lunar", date: "2026-06-01", isLeapMonth: true },
    { calendar: "solar", date: "2026-02-30" },
    { calendar: "lunar", date: "2025-06-31", isLeapMonth: true },
  ])
    assert.throws(() => convertCalendar(args), EngineQueryError);
});

test("untrusted model arguments cannot request unbounded computation or spill raw birthday information", () => {
  for (const args of [
    { scopes: ["monthly"], dates: ["2026-02-30"] },
    { scopes: ["hourly"], timeIndex: 13 },
    { scopes: ["hourly"] },
    { scopes: ["bogus"] },
    { scopes: ["monthly", "daily"], dates: Array(7).fill("2026-11-03") },
    { scopes: [], dates: [] },
  ])
    assert.throws(() => query(args), EngineQueryError);
  for (const args of [
    { kind: "days", count: 8 },
    { kind: "months", year: 3000 },
    { kind: "years", year: 2100, count: 2 },
    { kind: "decade_years", decadeIndex: 12 },
    { kind: "days", startDate: "2100-12-31", count: 7 },
  ])
    assert.throws(() => list(args), EngineQueryError);
  assert.throws(
    () => executeEngineQuery("eval", {}, chart, now),
    EngineQueryError,
  );
  const serialized = JSON.stringify([
    query({ scopes: ["monthly", "daily"] }),
    list({ kind: "months", year: 2026 }),
    inspectChart(chart, { view: "metadata" }),
  ]);
  for (const secret of [
    "PRIVATE_NAME",
    sampleInput.date,
    "birthInfo",
    "rawDates",
  ])
    assert.ok(!serialized.includes(secret));
});

test("natural questions request only relevant data and resolve dates in Shanghai, including year rollovers", () => {
  assert.equal(
    chartForQuestion(chart, "我的性格怎么样", now).timing.annualPeriods.length,
    0,
  );
  assert.equal(
    chartForQuestion(chart, "我的性格怎么样", now).requestedData.length,
    0,
  );
  const tomorrow = questionQueries("明天的工作状态怎么样", chart, now)[0];
  assert.deepEqual(tomorrow.args.dates, ["2026-11-04"]);
  assert.deepEqual(tomorrow.args.scopes, ["yearly", "monthly", "daily"]);
  const nextMonth = questionQueries(
    "下个月呢",
    chart,
    new Date("2026-12-30T16:00:00Z"),
  )[0];
  assert.deepEqual(nextMonth.args, {
    kind: "months",
    year: 2027,
    month: 1,
    calendar: "solar",
  });
  assert.equal(
    questionQueries("2027年六月怎么样", chart, now)[0].args.month,
    6,
  );
  assert.equal(
    questionQueries("2027年流月", chart, now)[0].args.month,
    undefined,
  );
  assert.equal(questionQueries("我现在的工作是否适合我", chart, now).length, 0);
  assert.deepEqual(questionQueries("2030年小限", chart, now)[0].args.dates, [
    "2030-02-03",
  ]);
  assert.equal(questionQueries("农历2026年2月30日", chart, now).length, 0);
  assert.throws(
    () => questionQueries("2101年1月", chart, now),
    EngineQueryError,
  );
  assert.equal(readingClock(new Date("2026-11-03T15:30:00Z")).timeIndex, 12);
});

test("date picker text survives storage and restores precise month/day/hour intent without a paid model call", () => {
  for (const scope of ["monthly", "daily", "hourly"]) {
    const question = withFortuneDate("只说工作方面。", scope, "2026-02-16", 12);
    assert.ok(question.endsWith("只说工作方面。"));
    const context = chartForQuestion(chart, question, now);
    assert.equal(context.timing.annualPeriods.length, 0);
    const data = context.requestedData[0] as any;
    assert.equal(data.query.tool, "get_horoscope");
    assert.equal(
      data.data.periods[0].layers.some((l: any) => l.scope === scope),
      true,
    );
    if (scope === "hourly")
      assert.equal(data.data.periods[0].effectiveDate, "2026-02-17");
  }
  assert.throws(
    () => withFortuneDate("hello", "daily", "2026-02-30", 0),
    EngineQueryError,
  );
});

test("alternate heaven/earth/human charts are independent and do not leak config or birth dates", () => {
  const before = chartForQuestion(chart, "性格", now);
  const raw = timingEngine(chart).raw;
  const earth = chartVariant(
    chart,
    { astroType: "earth", date: "2026-11-03", scopes: ["monthly", "daily"] },
    now,
  );
  const human = chartVariant(chart, { astroType: "human" }, now);
  assert.equal(earth.lifePalace, raw.earthlyBranchOfBodyPalace);
  assert.equal(human.lifePalace, raw.palace("福德")!.earthlyBranch);
  assert.equal(earth.palaces.length, 12);
  assert.equal(earth.timing?.layers.length, 2);
  assert.deepEqual(chartForQuestion(chart, "性格", now), before);
  assert.ok(!JSON.stringify(earth).includes(sampleInput.date));
  assert.throws(
    () => chartVariant(chart, { astroType: "arbitrary" }, now),
    EngineQueryError,
  );
});
