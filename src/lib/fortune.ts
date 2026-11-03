import { astro } from "iztro";
import { Lunar, Solar } from "lunar-javascript";
import { branches, type ZiweiChart } from "./chart";

/** Use the same calendar day in the browser and on UTC-hosted servers. */
export function readingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}

export function validateFortuneYears(years: unknown): number[] {
  if (
    !Array.isArray(years) ||
    !years.length ||
    years.length > 5 ||
    years.some((year) => !Number.isInteger(year) || year < 1900 || year > 2100)
  ) {
    throw new RangeError("流年查询每次支持 1—5 个年份，范围为 1900—2100 年。");
  }
  return [...new Set(years as number[])];
}

export function lunarYearStart(year: number): string {
  const solar = Lunar.fromYmd(year, 1, 1).getSolar();
  return [solar.getYear(), solar.getMonth(), solar.getDay()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, "0"))
    .join("-");
}

/** Rebuild the engine using the same fixed conventions as the displayed chart. */
export function timingEngine(chart: ZiweiChart) {
  const birth = chart.birthInfo;
  const birthDate = `${birth.year}-${String(birth.month).padStart(2, "0")}-${String(birth.day).padStart(2, "0")}`;
  astro.config({
    yearDivide: "normal",
    horoscopeDivide: "normal",
    ageDivide: "normal",
    dayDivide: "forward",
  });
  return {
    birthDate,
    raw: astro.bySolar(
      birthDate,
      birth.hour,
      birth.gender === "male" ? "男" : "女",
      true,
      "zh-CN",
    ),
  };
}

/** Static mode has no tool loop; include explicit years and common relative years. */
export function questionYears(
  question: string,
  now = new Date(),
): number[] | undefined {
  const year = Number(readingDate(now).slice(0, 4));
  const found = [
    ...question.matchAll(/(?<!\d)((?:19|20)\d{2}|2100)\s*年/g),
  ].map((m) => Number(m[1]));
  if (/今年/.test(question)) found.push(year);
  if (/明年/.test(question)) found.push(year + 1);
  if (/后年/.test(question)) found.push(year + 2);
  return found.length
    ? validateFortuneYears([...new Set(found)].slice(0, 5))
    : undefined;
}

export function withFortuneYears(
  question: string,
  startYear: number,
  count: number,
): string {
  if (![1, 3, 5].includes(count))
    throw new RangeError("请选择单年、连续 3 年或连续 5 年。");
  const years = validateFortuneYears(
    Array.from({ length: count }, (_, index) => startYear + index),
  );
  const content = `查看流年：${years.map((year) => `${year}年`).join("、")}。\n${question.trim()}`;
  if (content.length > 6000)
    throw new RangeError("选择流年后，请将问题缩短至 5900 字以内。");
  return content;
}

/** Derived timing data only: never serialize the raw astrolabe or birth input. */
export function fortuneContext(
  chart: ZiweiChart,
  requestedYears?: unknown,
  now = new Date(),
  includeAnnual = true,
) {
  const referenceDate = readingDate(now);
  const currentYear = Number(referenceDate.slice(0, 4));
  const [y, m, d] = referenceDate.split("-").map(Number);
  const currentLunarYear = Solar.fromYmd(y, m, d).getLunar().getYear();
  const years = !includeAnnual
    ? []
    : requestedYears === undefined
      ? [
          ...new Set([
            currentLunarYear,
            currentYear,
            currentYear + 1,
            currentYear + 2,
          ]),
        ].filter((year) => year >= 1900 && year <= 2100)
      : validateFortuneYears(requestedYears);
  const { raw, birthDate } = timingEngine(chart);
  const periodAt = (date: string) => {
    if (date < birthDate) return null;
    const horoscope = raw.horoscope(date, 0);
    const nominalAge = horoscope.age.nominalAge;
    const period = chart.daXians.find(
      (p) => nominalAge >= p.startAge && nominalAge <= p.endAge,
    );
    return {
      nominalAge,
      decadal: period
        ? {
            startAge: period.startAge,
            endAge: period.endAge,
            lifePalaceBranch: branches[period.palaceBranch],
            natalPalace: period.palaceName,
          }
        : null,
      decadalStatus: period
        ? "active"
        : nominalAge < chart.wuxingJu
          ? "not_started"
          : "outside_calculated_range",
    };
  };
  return {
    referenceDate,
    currentLunarYear,
    timezone: "Asia/Shanghai",
    convention:
      "虚岁及流年以农历正月初一换年；闰月分半。大限默认沿用本命年龄段与宫位迁移。小限、流月、流日、流时及扩展四化可以按需查询，未附带不代表不支持；时间层与本命层分开，不改写本命星曜和四化。",
    current: periodAt(referenceDate),
    decadalSchedule: chart.daXians.map((period) => ({
      startAge: period.startAge,
      endAge: period.endAge,
      lifePalaceBranch: branches[period.palaceBranch],
      natalPalace: period.palaceName,
    })),
    annualPeriods: years.map((year) => {
      const startDate = lunarYearStart(year);
      const endDate = new Date(
        Date.parse(`${lunarYearStart(year + 1)}T00:00:00Z`) - 86400000,
      )
        .toISOString()
        .slice(0, 10);
      // A birth-year period must never be sampled before the person's birth.
      if (endDate < birthDate)
        return { year, startDate, endDate, status: "before_birth" as const };
      // Use a public calendar boundary rather than exposing the exact birth date.
      const asOfDate = startDate < birthDate ? endDate : startDate;
      const yearly = raw.horoscope(asOfDate, 0).yearly;
      return {
        year,
        startDate,
        endDate,
        asOfDate,
        status: "available" as const,
        ...periodAt(asOfDate),
        stemBranch: `${yearly.heavenlyStem}${yearly.earthlyBranch}`,
        lifePalaceBranch: raw.palaces[yearly.index].earthlyBranch,
        palaces: raw.palaces.map((palace, index) => ({
          branch: palace.earthlyBranch,
          annualPalace: yearly.palaceNames[index],
          natalPalace: palace.name,
          transitStars: (yearly.stars?.[index] ?? []).map((star) => star.name),
        })),
        fourTransformations: yearly.mutagen.map((star, index) => ({
          transformation: ["禄", "权", "科", "忌"][index],
          star,
          natalBranches: chart.palaces
            .filter((p) => p.stars.some((s) => s.name === star))
            .map((p) => branches[p.branch]),
        })),
      };
    }),
  };
}
