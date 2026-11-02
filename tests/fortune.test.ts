import assert from "node:assert/strict";
import test from "node:test";
import { createChart, sampleInput } from "../src/lib/chart";
import { chartForAI } from "../src/lib/ai";
import {
  fortuneContext,
  readingDate,
  questionYears,
  validateFortuneYears,
  withFortuneYears,
} from "../src/lib/fortune";

const chart = createChart({ ...sampleInput, name: "PRIVATE_BIRTH_NAME" });
const now = new Date("2026-11-02T04:00:00Z");

test("reference date is Shanghai time and nominal age changes at lunar new year", () => {
  assert.equal(readingDate(new Date("2026-02-16T16:00:00Z")), "2026-02-17");
  const before = fortuneContext(
    chart,
    [2026],
    new Date("2026-02-16T15:59:59Z"),
  );
  const after = fortuneContext(chart, [2026], new Date("2026-02-16T16:00:00Z"));
  assert.equal(before.current?.nominalAge, 31);
  assert.equal(after.current?.nominalAge, 32);
  assert.equal(after.annualPeriods[0].startDate, "2026-02-17");
  assert.equal(after.annualPeriods[0].endDate, "2027-02-05");
  assert.equal(before.currentLunarYear, 2025);
  assert.equal(after.currentLunarYear, 2026);
  assert.deepEqual(
    fortuneContext(
      chart,
      undefined,
      new Date("2026-01-01T00:00:00Z"),
    ).annualPeriods.map((p) => p.year),
    [2025, 2026, 2027, 2028],
  );
});

test("annual palace indexes map from iztro 寅-first order to real earthly branches", () => {
  const period = fortuneContext(chart, [2024], now).annualPeriods[0];
  assert.equal(period.status, "available");
  if (period.status !== "available") return;
  assert.equal(period.lifePalaceBranch, "辰");
  assert.equal(period.stemBranch, "甲辰");
  assert.equal(
    period.palaces.find((p) => p.annualPalace === "命宫")?.branch,
    "辰",
  );
  assert.equal(new Set(period.palaces.map((p) => p.branch)).size, 12);
  assert.deepEqual(
    period.fourTransformations.map((p) => [p.transformation, p.star]),
    [
      ["禄", "廉贞"],
      ["权", "破军"],
      ["科", "武曲"],
      ["忌", "太阳"],
    ],
  );
  for (const transformation of period.fourTransformations)
    assert.equal(transformation.natalBranches.length, 1);
});

test("decadal boundary advances from 24–33 to 34–43, with gender direction preserved", () => {
  const years = fortuneContext(chart, [2027, 2028], now).annualPeriods;
  assert.ok(years[0].status === "available" && years[1].status === "available");
  assert.equal(years[0].nominalAge, 33);
  assert.equal(years[1].nominalAge, 34);
  assert.equal(years[0].decadal?.lifePalaceBranch, "午");
  assert.equal(years[1].decadal?.lifePalaceBranch, "未");
  const male = fortuneContext(
    createChart({ ...sampleInput, gender: "male" }),
    [2026],
    now,
  );
  assert.equal(male.current?.decadal?.lifePalaceBranch, "寅");
});

test("year queries are bounded and preserve requested ordering without duplicates", () => {
  assert.deepEqual(validateFortuneYears([2030, 2025, 2030]), [2030, 2025]);
  for (const bad of [
    [],
    null,
    "2026",
    [1899],
    [2101],
    [2026.5],
    [2020, 2021, 2022, 2023, 2024, 2025],
  ])
    assert.throws(() => fortuneContext(chart, bad, now), RangeError);
  assert.deepEqual(questionYears("看2030年和明年", now), [2030, 2027]);
  assert.deepEqual(questionYears("今年和后年呢", now), [2026, 2028]);
  assert.equal(questionYears("整体解读", now), undefined);
  assert.deepEqual(
    fortuneContext(chart, undefined, now).annualPeriods.map((p) => p.year),
    [2026, 2027, 2028],
  );
});

test("birth-year and pre-birth queries do not leak dates or fabricate active decades", () => {
  const data = chartForAI(chart, [1994, 1995, 2100], now);
  assert.equal(data.timing.annualPeriods[0].status, "before_birth");
  const first = data.timing.annualPeriods[1];
  assert.ok(first.status === "available");
  assert.equal(first.nominalAge, 1);
  assert.equal(first.decadal, null);
  assert.equal(first.decadalStatus, "not_started");
  const serialized = JSON.stringify(data);
  for (const excluded of [
    sampleInput.date,
    "PRIVATE_BIRTH_NAME",
    "birthInfo",
    "lunarInfo",
  ])
    assert.ok(!serialized.includes(excluded));
  const future = fortuneContext(
    createChart({ ...sampleInput, date: "2100-08-17" }),
    [2026],
    now,
  );
  assert.equal(future.current, null);
  assert.equal(future.annualPeriods[0].status, "before_birth");
});

test("the user's year picker preserves the question and selects all five years", () => {
  const question = "只看工作上的变化，不用逐宫报告。";
  const content = withFortuneYears(question, 2030, 5);
  assert.ok(content.endsWith(question));
  assert.deepEqual(questionYears(content, now), [2030, 2031, 2032, 2033, 2034]);
  assert.deepEqual(
    fortuneContext(chart, questionYears(content, now), now).annualPeriods.map(
      (p) => p.year,
    ),
    [2030, 2031, 2032, 2033, 2034],
  );
  assert.throws(() => withFortuneYears(question, 2098, 5), RangeError);
  assert.throws(() => withFortuneYears(question, 2026, 2), RangeError);
});
