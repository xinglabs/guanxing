import { astro, util } from "iztro";
import type { HoroscopeItem } from "iztro/lib/data/types";
import { Lunar, LunarMonth, Solar } from "lunar-javascript";
import { branches, type ZiweiChart, type Palace } from "./chart";
import { readingDate, timingEngine, lunarYearStart } from "./fortune";
import { STEMS } from "./ziwei/constants";

export class EngineQueryError extends Error {}
export const scopes = [
  "decadal",
  "age",
  "yearly",
  "monthly",
  "daily",
  "hourly",
] as const;
type Scope = (typeof scopes)[number];
type Args = Record<string, unknown>;
type Engine = ReturnType<typeof timingEngine>;
export const engineCapabilities = {
  engine: "iztro 2.6.3 + 观星本命口径",
  timing: scopes,
  chartVariants: ["heaven", "earth", "human"],
  lists: ["decades", "decade_years", "years", "months", "days", "hours"],
  analysis: [
    "宫位与星曜",
    "身宫与来因宫",
    "三方四正",
    "夹宫",
    "空宫借星",
    "宫干飞化与自化",
    "四组十二神",
    "星曜组合核验",
    "公农历转换",
  ],
  queryRange: "1900—2100；流时区分早子时0与晚子时12；参考时区Asia/Shanghai",
};
const convention =
  "虚岁、流年按农历正月初一换年，流月按农历月、闰月分半；晚子时23:00按次日早子时计算。大限/小限四化、宫干飞化为单独标记的扩展层，不替换本命四化；星曜位置和亮度以本站本命盘为准。";
const labels = ["禄", "权", "科", "忌"];
export const timeLabels = [
  "早子时 00:00—01:00",
  "丑时 01:00—03:00",
  "寅时 03:00—05:00",
  "卯时 05:00—07:00",
  "辰时 07:00—09:00",
  "巳时 09:00—11:00",
  "午时 11:00—13:00",
  "未时 13:00—15:00",
  "申时 15:00—17:00",
  "酉时 17:00—19:00",
  "戌时 19:00—21:00",
  "亥时 21:00—23:00",
  "晚子时 23:00—24:00",
];
function fail(message: string): never {
  throw new EngineQueryError(message);
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${label}须为 ${min}—${max} 的整数。`);
  return value;
}
export function queryDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("查询日期请使用 YYYY-MM-DD 公历格式。");
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1900 ||
    y > 2100 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    fail("请输入 1900—2100 年内真实存在的查询日期。");
  return value;
}
export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
function solarString(solar: Solar) {
  return [solar.getYear(), solar.getMonth(), solar.getDay()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, "0"))
    .join("-");
}
function lunarSolar(year: number, month: number, day: number) {
  return solarString(Lunar.fromYmd(year, month, day).getSolar());
}
function lunarParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const l = Solar.fromYmd(y, m, d).getLunar();
  return {
    year: l.getYear(),
    month: Math.abs(l.getMonth()),
    day: l.getDay(),
    isLeapMonth: l.getMonth() < 0,
  };
}
function transformations(chart: ZiweiChart, stars: readonly string[]) {
  return stars.map((star, index) => ({
    transformation: labels[index],
    star,
    natalBranches: chart.palaces
      .filter((p) => p.stars.some((s) => s.name === star))
      .map((p) => branches[p.branch]),
  }));
}
function layer(
  chart: ZiweiChart,
  engine: Engine,
  item: HoroscopeItem,
  scope: Scope,
  compact = false,
) {
  if (item.index < 0 || item.index > 11)
    return { scope, status: "outside_calculated_range" };
  const palaces = engine.raw.palaces.map((p, i) => ({
    branch: p.earthlyBranch,
    palace: item.palaceNames[i],
    natalPalace: p.name,
    transitStars: (item.stars?.[i] ?? []).map((s) => s.name),
  }));
  return {
    scope,
    name: item.name,
    status: "available",
    stemBranch: item.heavenlyStem + item.earthlyBranch,
    lifePalaceBranch: engine.raw.palaces[item.index].earthlyBranch,
    fourTransformations: transformations(chart, item.mutagen),
    ...(scope === "decadal" || scope === "age"
      ? { interpretationLayer: "iztro 扩展四化，独立于本命口径" }
      : {}),
    ...(compact
      ? {
          transits: palaces
            .filter((p) => p.transitStars.length)
            .map(({ branch, transitStars }) => ({
              branch,
              stars: transitStars,
            })),
        }
      : { palaces }),
  };
}
function atDate(
  chart: ZiweiChart,
  engine: Engine,
  date: string,
  selected: Scope[],
  timeIndex = 0,
  compact = false,
) {
  const effectiveDate = timeIndex === 12 ? shiftDate(date, 1) : date;
  const base = {
    date,
    effectiveDate,
    ...(selected.includes("hourly")
      ? { timeIndex, timeLabel: timeLabels[timeIndex] }
      : {}),
  };
  if (effectiveDate < engine.birthDate)
    return { ...base, status: "before_birth", layers: [] };
  const h = engine.raw.horoscope(
    effectiveDate,
    timeIndex === 12 ? 0 : timeIndex,
  );
  const lunar = lunarParts(effectiveDate);
  const layers = selected.map((scope) => {
    const item = layer(chart, engine, h[scope], scope, compact);
    if (scope === "monthly") {
      const signed = lunar.isLeapMonth ? -lunar.month : lunar.month;
      const days = LunarMonth.fromYm(lunar.year, signed)!.getDayCount();
      const first = lunar.isLeapMonth && lunar.day > 15 ? 16 : 1;
      const last = lunar.isLeapMonth && lunar.day <= 15 ? 15 : days;
      return {
        ...item,
        lunarMonth: lunar.month,
        isLeapMonth: lunar.isLeapMonth,
        part: lunar.isLeapMonth ? (first === 1 ? "first" : "second") : "normal",
        startDate: lunarSolar(lunar.year, signed, first),
        endDate: lunarSolar(lunar.year, signed, last),
      };
    }
    if (scope === "yearly")
      return {
        ...item,
        startDate: lunarYearStart(lunar.year),
        endDate: shiftDate(lunarYearStart(lunar.year + 1), -1),
        auxiliaryStars: engine.raw.palaces.map((p, i) => ({
          branch: p.earthlyBranch,
          jiangqian: h.yearly.yearlyDecStar.jiangqian12[i],
          suiqian: h.yearly.yearlyDecStar.suiqian12[i],
        })),
      };
    return item;
  });
  return {
    ...base,
    status: "available",
    lunar,
    nominalAge: h.age.nominalAge,
    layers,
  };
}
export function getHoroscope(chart: ZiweiChart, args: Args, now = new Date()) {
  if (
    !Array.isArray(args.scopes) ||
    !args.scopes.length ||
    args.scopes.length > 6 ||
    args.scopes.some((v) => !scopes.includes(v as Scope))
  )
    fail("请指定大限、小限、流年、流月、流日或流时查询层级。");
  const selected = [...new Set(args.scopes)] as Scope[];
  const dates = args.dates === undefined ? [readingDate(now)] : args.dates;
  if (
    !Array.isArray(dates) ||
    !dates.length ||
    dates.length > 7 ||
    dates.length * selected.length > 12
  )
    fail("一次最多查询 7 个日期、合计 12 个时间层，请缩小查询范围。");
  const validated = [...new Set(dates.map(queryDate))];
  const timeIndex = selected.includes("hourly")
    ? integer(args.timeIndex, 0, 12, "流时时辰序号")
    : 0;
  const engine = timingEngine(chart);
  return {
    timezone: "Asia/Shanghai",
    convention,
    periods: validated.map((date) =>
      atDate(chart, engine, date, selected, timeIndex),
    ),
  };
}
export function listFortunePeriods(
  chart: ZiweiChart,
  args: Args,
  now = new Date(),
) {
  const engine = timingEngine(chart);
  const current = readingDate(now);
  const year = integer(
    args.year ?? lunarParts(current).year,
    1900,
    2100,
    "年份",
  );
  let periods: unknown[];
  switch (args.kind) {
    case "decades":
      periods = engine.raw.decadalList().map((p) => ({
        ageRange: p.ageRange,
        yearRange: p.yearRange,
        natalPalace: p.palaceName,
        ...layer(chart, engine, p, "decadal", true),
      }));
      break;
    case "decade_years": {
      const index = integer(args.decadeIndex, 0, 11, "大限序号");
      periods = engine.raw
        .yearlyList(index)
        .filter((p) => p.year >= 1900 && p.year <= 2100)
        .map((p) => ({
          year: p.year,
          nominalAge: p.age,
          ...layer(chart, engine, p, "yearly", true),
        }));
      break;
    }
    case "years": {
      const count = integer(args.count ?? 3, 1, 5, "年份数量");
      if (year + count - 1 > 2100) fail("查询年份不能超过 2100 年。");
      periods = Array.from({ length: count }, (_, i) => {
        const start = lunarYearStart(year + i),
          end = shiftDate(lunarYearStart(year + i + 1), -1);
        const date =
          start < engine.birthDate && end >= engine.birthDate ? end : start;
        return {
          year: year + i,
          ...atDate(chart, engine, date, ["yearly"], 0, true),
        };
      });
      break;
    }
    case "months": {
      const calendar = args.calendar ?? "lunar";
      if (calendar !== "lunar" && calendar !== "solar")
        fail("历法请选择 solar（公历）或 lunar（农历）。");
      const month =
        args.month === undefined
          ? undefined
          : integer(args.month, 1, 12, "月份");
      const start =
        calendar === "solar"
          ? `${year}-${String(month ?? 1).padStart(2, "0")}-01`
          : undefined;
      const end = start
        ? shiftDate(
            month === 12 || !month
              ? `${year + 1}-01-01`
              : `${year}-${String(month + 1).padStart(2, "0")}-01`,
            -1,
          )
        : undefined;
      const years = calendar === "solar" ? [year - 1, year] : [year];
      periods = years
        .flatMap((y) => engine.raw.monthlyList(y, true))
        .filter(
          (p) =>
            calendar === "solar" || month === undefined || p.month === month,
        )
        .map((p) => {
          const signed = p.isLeapMonth ? -p.month : p.month;
          const startDate = lunarSolar(p.year, signed, p.dayRange[0]);
          const endDate = lunarSolar(p.year, signed, p.dayRange[1]);
          const viewStart = start && start > startDate ? start : startDate;
          const viewEnd = end && end < endDate ? end : endDate;
          if (viewStart > viewEnd) return null;
          const base = {
            year: p.year,
            month: p.month,
            isLeapMonth: p.isLeapMonth,
            part: p.part,
            startDate,
            endDate,
            viewStart,
            viewEnd,
          };
          if (viewEnd < engine.birthDate)
            return { ...base, status: "before_birth" };
          const asOfDate = viewStart < engine.birthDate ? viewEnd : viewStart;
          const item = engine.raw.horoscope(asOfDate, 0).monthly;
          return {
            ...base,
            asOfDate,
            nominalAge: p.age,
            ...layer(chart, engine, item, "monthly", true),
          };
        })
        .filter((p) => p !== null);
      break;
    }
    case "days": {
      const date = queryDate(args.startDate ?? current);
      const count = integer(args.count ?? 7, 1, 7, "天数");
      const dates = Array.from({ length: count }, (_, i) =>
        queryDate(shiftDate(date, i)),
      );
      periods = dates.map((d) => atDate(chart, engine, d, ["daily"], 0, true));
      break;
    }
    case "hours": {
      const date = queryDate(args.startDate ?? current);
      periods = Array.from({ length: 13 }, (_, i) =>
        atDate(chart, engine, date, ["hourly"], i, true),
      );
      break;
    }
    default:
      fail("时间表类型不支持。");
  }
  return {
    timezone: "Asia/Shanghai",
    convention,
    kind: args.kind,
    calendar: args.calendar ?? "lunar",
    periods,
  };
}
function palaceData(p: Palace) {
  return {
    palace: p.name,
    branch: branches[p.branch],
    stem: STEMS[p.stem],
    isBodyPalace: !!p.isShenGong,
    stars: p.stars.map((s) => ({
      name: s.name,
      type: s.type,
      brightness: s.brightnessRaw,
      transformation: s.siHua,
    })),
    isEmpty: !!p.isEmpty,
    borrowedFrom: p.borrowedFromName,
    borrowedStars: p.borrowedStars ?? [],
  };
}
export function inspectChart(chart: ZiweiChart, args: Args, now = new Date()) {
  const engine = timingEngine(chart);
  if (args.view === "metadata")
    return {
      soul: chart.mingZhu,
      body: chart.shenZhu,
      zodiac: engine.raw.zodiac,
      sign: engine.raw.sign,
      fiveElementsClass: chart.wuxingJuName,
      yinYangGender: chart.yinYangGender,
      fourPillars: {
        solarTerms: chart.lunarInfo.fourPillars,
        lunar: chart.lunarInfo.fourPillarsLunar,
      },
    };
  const scope = args.scope ?? "origin";
  if (scope !== "origin" && !scopes.includes(scope as Scope))
    fail("查询时间层不支持。");
  const date = queryDate(args.date ?? readingDate(now));
  const timeIndex =
    scope === "hourly" ? integer(args.timeIndex, 0, 12, "流时时辰序号") : 0;
  const effectiveDate = timeIndex === 12 ? shiftDate(date, 1) : date;
  if (scope !== "origin" && effectiveDate < engine.birthDate)
    return { scope, date, status: "before_birth" };
  const h =
    scope === "origin"
      ? undefined
      : engine.raw.horoscope(effectiveDate, timeIndex === 12 ? 0 : timeIndex);
  const timeLayer = h?.[scope as Scope];
  if (timeLayer && timeLayer.index < 0)
    return { scope, date, status: "outside_calculated_range" };
  let target: Palace | undefined;
  if (typeof args.star === "string" && args.star.length <= 20)
    target = chart.palaces.find((p) =>
      p.stars.some((s) => s.name === args.star),
    );
  else if (typeof args.palace === "string" && args.palace.length <= 20) {
    const name = args.palace
      .replace(/宫$/u, "")
      .replace("事业", "官禄")
      .replace("交友", "仆役");
    if (name === "身") target = chart.palaces.find((p) => p.isShenGong);
    else if (name === "来因") {
      const original = engine.raw.palaces.find((p) => p.isOriginalPalace);
      target = chart.palaces.find(
        (p) => branches[p.branch] === original?.earthlyBranch,
      );
    } else if (timeLayer && !branches.includes(name)) {
      const index = timeLayer.palaceNames.findIndex(
        (p) => p.replace(/宫$/u, "") === name,
      );
      target = chart.palaces.find(
        (p) => branches[p.branch] === engine.raw.palaces[index]?.earthlyBranch,
      );
    } else
      target = chart.palaces.find(
        (p) =>
          p.name.replace(/宫$/u, "") === name || branches[p.branch] === name,
      );
  }
  if (!target) fail("请指定命盘中存在的宫位、地支或星曜名称。");
  const views = ["relationships", "mutagens", "auxiliary", "stars"];
  if (args.view !== undefined && !views.includes(String(args.view)))
    fail("宫位查询类型不支持。");
  const at = (offset: number) =>
    chart.palaces.find(
      (p) => p.branch === (target!.branch + offset + 12) % 12,
    )!;
  const reference = engine.raw.palaces.find(
    (p) => p.earthlyBranch === branches[target!.branch],
  )!;
  const inScope = (p: Palace) => {
    if (!timeLayer) return palaceData(p);
    const index = engine.raw.palaces.findIndex(
      (raw) => raw.earthlyBranch === branches[p.branch],
    );
    return {
      ...palaceData(p),
      scopePalace: timeLayer.palaceNames[index],
      transitStars: (timeLayer.stars?.[index] ?? []).map((s) => s.name),
      timeTransformations: transformations(chart, timeLayer.mutagen).filter(
        (f) => f.natalBranches.includes(branches[p.branch]),
      ),
    };
  };
  const base = {
    source: "本站本命位置与亮度；iztro 按地支映射的辅助数据",
    scope,
    ...(timeLayer
      ? {
          date,
          effectiveDate,
          timeIndex,
          timeLayer: layer(chart, engine, timeLayer, scope as Scope, true),
        }
      : {}),
    target: inScope(target),
    ...(args.star
      ? { queriedStar: target.stars.find((s) => s.name === args.star) }
      : {}),
  };
  if (args.view === "auxiliary")
    return {
      ...base,
      isOriginalPalace: reference.isOriginalPalace,
      smallLimitAges: reference.ages,
      auxiliaryStars: {
        changsheng: reference.changsheng12,
        boshi: reference.boshi12,
        jiangqian: reference.jiangqian12,
        suiqian: reference.suiqian12,
      },
      note: "四组十二神独立列出；与本命同名的神煞不重复叠算，不据神煞名称断定疾病、死亡或灾祸。",
    };
  if (args.view === "mutagens") {
    const flights = transformations(
      chart,
      util.getMutagensByHeavenlyStem(reference.heavenlyStem),
    );
    return {
      ...base,
      interpretationLayer: "宫干飞化扩展；不替换本命四化",
      flights,
      selfTransformations: flights.filter((f) =>
        f.natalBranches.includes(branches[target!.branch]),
      ),
    };
  }
  const groups = {
    target: [target],
    surrounded: [target, at(4), at(6), at(8)],
    flanking: [at(-1), at(1)],
  };
  let checks;
  if (args.stars !== undefined) {
    if (
      !Array.isArray(args.stars) ||
      !args.stars.length ||
      args.stars.length > 20 ||
      args.stars.some((s) => typeof s !== "string" || s.length > 20)
    )
      fail("核验星曜需要 1—20 个星名。");
    const wanted = args.stars as string[];
    checks = Object.fromEntries(
      Object.entries(groups).map(([key, ps]) => {
        const stars = ps.flatMap((p) => p.stars);
        const matched = wanted.filter((n) => stars.some((s) => s.name === n));
        return [
          key,
          {
            all: matched.length === wanted.length,
            any: !!matched.length,
            none: !matched.length,
            matched,
            transformations: [
              ...new Set(stars.flatMap((s) => (s.siHua ? [s.siHua] : []))),
            ],
            ...(timeLayer
              ? {
                  transitMatches: wanted.filter((name) =>
                    ps.some((p) => {
                      const index = engine.raw.palaces.findIndex(
                        (raw) => raw.earthlyBranch === branches[p.branch],
                      );
                      return timeLayer.stars?.[index]?.some(
                        (s) => s.name === name,
                      );
                    }),
                  ),
                }
              : {}),
          },
        ];
      }),
    );
  }
  return {
    ...base,
    opposite: inScope(at(6)),
    surrounded: groups.surrounded.map(inScope),
    flanking: groups.flanking.map(inScope),
    ...(checks ? { checks } : {}),
  };
}
export function convertCalendar(args: Args) {
  if (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))
    fail("日期格式须为 YYYY-MM-DD。");
  if (args.calendar === "solar") {
    const solar = queryDate(args.date);
    return { solar, lunar: lunarParts(solar) };
  }
  if (args.calendar !== "lunar") fail("请指定 solar（公历）或 lunar（农历）。");
  const [y, m, d] = args.date.split("-").map(Number);
  integer(y, 1900, 2100, "农历年份");
  integer(m, 1, 12, "农历月份");
  if (args.isLeapMonth !== undefined && typeof args.isLeapMonth !== "boolean")
    fail("闰月标记须为布尔值。");
  const signed = args.isLeapMonth ? -m : m;
  const month = LunarMonth.fromYm(y, signed);
  if (!month || d < 1 || d > month.getDayCount())
    fail("该农历日期或闰月不存在。");
  return {
    solar: lunarSolar(y, signed, d),
    lunar: { year: y, month: m, day: d, isLeapMonth: !!args.isLeapMonth },
  };
}

/** Explicit alternate-school query: never replace or mutate the saved natal chart. */
export function chartVariant(chart: ZiweiChart, args: Args, now = new Date()) {
  if (!["heaven", "earth", "human"].includes(String(args.astroType)))
    fail("请选择 heaven 天盘、earth 地盘或 human 人盘。");
  const { birthDate } = timingEngine(chart);
  const raw = astro.withOptions({
    type: "solar",
    dateStr: birthDate,
    timeIndex: chart.birthInfo.hour,
    gender: chart.birthInfo.gender === "male" ? "男" : "女",
    fixLeap: true,
    language: "zh-CN",
    astroType: args.astroType as "heaven" | "earth" | "human",
    config: {
      algorithm: "zhongzhou",
      yearDivide: "normal",
      horoscopeDivide: "normal",
      ageDivide: "normal",
      dayDivide: "forward",
    },
  });
  const palaces = raw.palaces.map((p) => ({
    palace: p.name,
    branch: p.earthlyBranch,
    stem: p.heavenlyStem,
    isBodyPalace: p.isBodyPalace,
    stars: [...p.majorStars, ...p.minorStars, ...p.adjectiveStars].map((s) => ({
      name: s.name,
      type: s.type,
      brightness: s.brightness,
      transformation: s.mutagen,
    })),
    decadalAge: p.decadal.range,
  }));
  let timing;
  if (args.scopes !== undefined) {
    if (
      !Array.isArray(args.scopes) ||
      !args.scopes.length ||
      args.scopes.length > 6 ||
      args.scopes.some((s) => !scopes.includes(s as Scope))
    )
      fail("请指定有效的时间层级。");
    const date = queryDate(args.date ?? readingDate(now));
    const selected = [...new Set(args.scopes)] as Scope[];
    const timeIndex = selected.includes("hourly")
      ? integer(args.timeIndex, 0, 12, "流时时辰序号")
      : 0;
    const variantChart = {
      ...chart,
      palaces: raw.palaces.map((p) => ({
        branch: branches.indexOf(p.earthlyBranch),
        stem: 0,
        name: p.name,
        stars: [...p.majorStars, ...p.minorStars, ...p.adjectiveStars].map(
          (s) => ({ name: s.name, type: "minor" as const }),
        ),
      })),
    };
    timing = atDate(
      variantChart,
      { raw, birthDate },
      date,
      selected,
      timeIndex,
    );
  }
  return {
    source: "iztro 中州天地人盘扩展＋当前亮度配置",
    astroType: args.astroType,
    convention:
      "此为独立流派对照，不替换本站本命盘，不能把对照盘星曜拼回主盘。需要运限时在同一次查询指定scopes。",
    lifePalace: raw.earthlyBranchOfSoulPalace,
    bodyPalace: raw.earthlyBranchOfBodyPalace,
    fiveElementsClass: raw.fiveElementsClass,
    palaces,
    ...(timing ? { timing } : {}),
  };
}

const yearProperty = { type: "integer", minimum: 1900, maximum: 2100 };
const dateProperty = {
  type: "string",
  description: "公历 YYYY-MM-DD，1900—2100",
};
function tool(
  name: string,
  description: string,
  properties: Args,
  required: string[] = [],
) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}
export const ENGINE_TOOLS = [
  tool(
    "get_chart_variant",
    "用户明确要对照天地人盘/中州派时，读取独立扩展盘；不会修改主盘。地盘以身宫、人盘以福德宫起命宫。需要该盘的时间层时同时给scopes/date，不能混用主盘运限。",
    {
      astroType: { type: "string", enum: ["heaven", "earth", "human"] },
      date: dateProperty,
      scopes: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string", enum: scopes },
      },
      timeIndex: { type: "integer", minimum: 0, maximum: 12 },
    },
    ["astroType"],
  ),
  tool(
    "get_horoscope",
    "按日期查询大限decadal、小限age、流年yearly、流月monthly、流日daily、流时hourly。可同时取上层运限做依据；只取需要的层级。流时须timeIndex，23点为12且按次日计算；省略dates默认今天。",
    {
      dates: { type: "array", minItems: 1, maxItems: 7, items: dateProperty },
      scopes: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string", enum: scopes },
      },
      timeIndex: { type: "integer", minimum: 0, maximum: 12 },
    },
    ["scopes"],
  ),
  tool(
    "list_fortune_periods",
    "按需取紧凑时间表：decades十二大限；decade_years指定decadeIndex(0—11)内十年；years从year起count年(最多5)；months指定year全年流月，可选month，calendar可选solar公历月份/年份或lunar农历(默认)；days从startDate起count天(最多7)；hours指定startDate的13个时段。细查某日再用get_horoscope。",
    {
      kind: {
        type: "string",
        enum: ["decades", "decade_years", "years", "months", "days", "hours"],
      },
      year: yearProperty,
      month: { type: "integer", minimum: 1, maximum: 12 },
      calendar: { type: "string", enum: ["solar", "lunar"] },
      startDate: dateProperty,
      count: { type: "integer", minimum: 1, maximum: 7 },
      decadeIndex: { type: "integer", minimum: 0, maximum: 11 },
    },
    ["kind"],
  ),
  tool(
    "inspect_chart",
    "查本命宫位或星曜的结构数据：relationships三方四正/对宫/夹宫/空宫借星；mutagens宫干飞化与自化(独立扩展层)；auxiliary四组十二神、小限年龄、来因宫；stars定位、庙旺与本命四化；metadata命主身主生肖星座。可用stars核验组合。scope默认origin本命，可指定时间层并给date查询运限宫位的三方四正，hourly须timeIndex。使用本站修正后的星曜位置和亮度。",
    {
      view: {
        type: "string",
        enum: ["relationships", "mutagens", "auxiliary", "stars", "metadata"],
      },
      palace: { type: "string", description: "宫名、身宫、来因宫或地支" },
      scope: { type: "string", enum: ["origin", ...scopes] },
      date: dateProperty,
      timeIndex: { type: "integer", minimum: 0, maximum: 12 },
      star: { type: "string" },
      stars: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string" },
      },
    },
  ),
  tool(
    "convert_calendar",
    "按用户给出的查询日期换算公历与农历，农历须明确闰月；不自动读取或披露完整出生日期。",
    {
      date: { type: "string", description: "YYYY-MM-DD" },
      calendar: { type: "string", enum: ["solar", "lunar"] },
      isLeapMonth: { type: "boolean" },
    },
    ["date", "calendar"],
  ),
];
export function executeEngineQuery(
  name: string,
  args: Args,
  chart: ZiweiChart,
  now = new Date(),
): unknown {
  if (name === "get_horoscope") return getHoroscope(chart, args, now);
  if (name === "list_fortune_periods")
    return listFortunePeriods(chart, args, now);
  if (name === "inspect_chart") return inspectChart(chart, args, now);
  if (name === "convert_calendar") return convertCalendar(args);
  if (name === "get_chart_variant") return chartVariant(chart, args, now);
  fail("不支持的命盘查询。");
}
