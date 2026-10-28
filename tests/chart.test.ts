import assert from "node:assert/strict";
import test from "node:test";
import {
  branches,
  createChart,
  sampleInput,
  describePalace,
} from "../src/lib/chart";

test("rejects nonexistent dates, malformed dates and dates outside supported range", () => {
  for (const date of [
    "2025-02-29",
    "2024-02-30",
    "1999-04-31",
    "2000-13-01",
    "2000-00-01",
    "2000-01-00",
    "2000-1-1",
    "1899-12-31",
    "2101-01-01",
  ]) {
    assert.throws(
      () => createChart({ ...sampleInput, date }),
      RangeError,
      date,
    );
  }
  for (const date of ["1900-01-01", "2000-02-29", "2024-02-29", "2100-12-31"]) {
    assert.equal(
      createChart({ ...sampleInput, date }).birthInfo.day,
      Number(date.slice(-2)),
    );
  }
});

test("sampled charts retain 12 unique palaces, all 14 major stars and one life palace", () => {
  for (const year of [1900, 1955, 1995, 2000, 2026, 2100]) {
    for (const gender of ["male", "female"] as const) {
      for (let hour = 0; hour < 12; hour++) {
        const chart = createChart({ date: `${year}-08-17`, hour, gender });
        assert.equal(chart.palaces.length, 12);
        assert.equal(new Set(chart.palaces.map((p) => p.name)).size, 12);
        assert.deepEqual(
          chart.palaces.map((p) => p.branch).sort((a, b) => a - b),
          Array.from({ length: 12 }, (_, i) => i),
        );
        const majors = chart.palaces.flatMap((p) =>
          p.stars.filter((s) => s.type === "major"),
        );
        assert.equal(majors.length, 14);
        assert.equal(new Set(majors.map((s) => s.name)).size, 14);
        assert.equal(chart.palaces.filter((p) => p.isMingGong).length, 1);
        assert.equal(
          chart.palaces.find((p) => p.isMingGong)?.branch,
          chart.mingGongBranch,
        );
        const ziwei = chart.palaces.find((p) =>
          p.stars.some((s) => s.name === "紫微"),
        )!;
        const tianfu = chart.palaces.find((p) =>
          p.stars.some((s) => s.name === "天府"),
        )!;
        assert.equal((ziwei.branch + tianfu.branch) % 12, 4);
      }
    }
  }
});

test("hour uses branch index; 23 clock hours is rejected and index 0 is 子", () => {
  assert.equal(branches[0], "子");
  for (const hour of [-1, 12, 23, 0.5, Number.NaN]) {
    assert.throws(() => createChart({ ...sampleInput, hour }), RangeError);
  }
  const chart = createChart({ ...sampleInput, date: "2000-01-31", hour: 0 });
  assert.deepEqual(
    {
      year: chart.birthInfo.year,
      month: chart.birthInfo.month,
      day: chart.birthInfo.day,
      hour: chart.birthInfo.hour,
    },
    { year: 2000, month: 1, day: 31, hour: 0 },
  );
});

test("missing runtime input and incorrect gender/name are rejected", () => {
  assert.throws(() => createChart(undefined as never), RangeError);
  assert.throws(
    () => createChart({ ...sampleInput, gender: "unknown" as never }),
    RangeError,
  );
  assert.throws(
    () => createChart({ ...sampleInput, name: "x".repeat(41) }),
    RangeError,
  );
});

test("palace descriptions report real computed data without pretending to be AI", () => {
  const chart = createChart(sampleInput);
  for (const palace of chart.palaces) {
    assert.match(describePalace(palace), new RegExp(palace.name));
    const majors = palace.stars.filter((s) => s.type === "major");
    if (majors.length)
      for (const star of majors)
        assert.ok(describePalace(palace).includes(star.name));
    else assert.ok(describePalace(palace).includes("本宫无主星"));
  }
});
