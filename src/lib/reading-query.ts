import { readingDate, questionYears, lunarYearStart } from "./fortune";
import {
  queryDate,
  shiftDate,
  timeLabels,
  EngineQueryError,
  executeEngineQuery,
} from "./engine-query";
import type { ZiweiChart } from "./chart";

type Query = { tool: string; args: Record<string, unknown> };
export function readingClock(now = new Date()) {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const hour = Number(clock.slice(0, 2));
  return {
    date: readingDate(now),
    clock,
    timeIndex: hour === 23 ? 12 : Math.floor((hour + 1) / 2),
    timezone: "Asia/Shanghai",
  };
}
export function withFortuneDate(
  question: string,
  scope: string,
  date: string,
  timeIndex: number,
) {
  queryDate(date);
  const names: Record<string, string> = {
    monthly: "流月",
    daily: "流日",
    hourly: "流时",
  };
  if (!names[scope]) throw new EngineQueryError("请选择流月、流日或流时。");
  if (
    scope === "hourly" &&
    (!Number.isInteger(timeIndex) || timeIndex < 0 || timeIndex > 12)
  )
    throw new EngineQueryError("请选择有效时辰。");
  const text = `查看${names[scope]}：${date}${scope === "hourly" ? `；时辰序号：${timeIndex}（${timeLabels[timeIndex]}）` : ""}。\n${question.trim()}`;
  if (text.length > 6000)
    throw new EngineQueryError("选择日期后，请将问题缩短至 5900 字以内。");
  return text;
}
/** A small deterministic fast path, not a substitute for the model's bounded query tools. */
export function questionQueries(
  question: string,
  chart: ZiweiChart,
  now = new Date(),
): Query[] {
  const current = readingClock(now);
  const [y, m] = current.date.split("-").map(Number);
  let year = questionYears(question, now)?.[0] ?? y;
  const queries: Query[] = [];
  const explicitYear = question.match(/(?<!\d)(\d{4})[年/-]/)?.[1];
  if (
    explicitYear &&
    (Number(explicitYear) < 1900 || Number(explicitYear) > 2100)
  )
    throw new EngineQueryError("查询年份范围为 1900—2100 年。");
  if (
    /农历|阴历|闰[一二三四五六七八九十\d]*月|初[一二三四五六七八九十]|廿/.test(
      question,
    ) &&
    !/^查看流[月日时]：/.test(question)
  )
    return queries;
  const dates = [
    ...question.matchAll(
      /(?<!\d)((?:19|20)\d{2}|2100)[年/-](\d{1,2})[月/-](\d{1,2})(?:日|号)?(?!\d)/g,
    ),
  ].map((match) =>
    queryDate(
      `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
    ),
  );
  if (!dates.length) {
    if (/后天/.test(question)) dates.push(shiftDate(current.date, 2));
    else if (/明天/.test(question)) dates.push(shiftDate(current.date, 1));
    else if (/昨天/.test(question)) dates.push(shiftDate(current.date, -1));
    else if (/今天|今日/.test(question)) dates.push(current.date);
    else {
      const md = question.match(/(?<!\d)(\d{1,2})月(\d{1,2})[日号]/);
      if (md)
        dates.push(
          queryDate(
            `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`,
          ),
        );
    }
  }
  const hourMatch = question.match(/时辰序号[：:]\s*(\d{1,2})/);
  const clockMatch = question.match(
    /(?<!\d)(\d{1,2})[点时:：](?:(\d{1,2})(?:分)?)?/,
  );
  let hourIndex = hourMatch ? Number(hourMatch[1]) : undefined;
  if (hourIndex === undefined && clockMatch) {
    const hour = Number(clockMatch[1]);
    if (hour > 23 || Number(clockMatch[2] ?? 0) > 59)
      throw new EngineQueryError("查询时间须为 00:00—23:59。");
    hourIndex = hour === 23 ? 12 : Math.floor((hour + 1) / 2);
  }
  const chineseHour = question.match(/([子丑寅卯辰巳午未申酉戌亥])时/);
  if (hourIndex === undefined && chineseHour)
    hourIndex = "子丑寅卯辰巳午未申酉戌亥".indexOf(chineseHour[1]);
  if (/晚子时/.test(question)) hourIndex = 12;
  if (/流时|现在的时辰/.test(question) || hourIndex !== undefined) {
    if (hourIndex === undefined && !/现在/.test(question))
      queries.push({
        tool: "list_fortune_periods",
        args: { kind: "hours", startDate: dates[0] ?? current.date },
      });
    else
      queries.push({
        tool: "get_horoscope",
        args: {
          dates: [dates[0] ?? current.date],
          scopes: ["yearly", "monthly", "daily", "hourly"],
          timeIndex: hourIndex ?? current.timeIndex,
        },
      });
  } else if (/^查看流月：/.test(question))
    queries.push({
      tool: "get_horoscope",
      args: { dates: dates.slice(0, 4), scopes: ["yearly", "monthly"] },
    });
  else if (dates.length || /流日|日运/.test(question))
    queries.push({
      tool: "get_horoscope",
      args: {
        dates: dates.length ? dates.slice(0, 4) : [current.date],
        scopes: ["yearly", "monthly", "daily"],
      },
    });
  else if (
    /下周|本周|这周|未来[一二三四五六七\d]*天|接下来[一二三四五六七\d]*天/.test(
      question,
    )
  ) {
    const weekday = new Date(current.date + "T00:00:00Z").getUTCDay() || 7;
    const delta = /下周/.test(question)
      ? 8 - weekday
      : /本周|这周/.test(question)
        ? 1 - weekday
        : 0;
    queries.push({
      tool: "list_fortune_periods",
      args: {
        kind: "days",
        startDate: shiftDate(current.date, delta),
        count: 7,
      },
    });
  } else if (
    /流月|每个?月|逐月|月份|[\d一二三四五六七八九十]月|本月|这个月|下个?月|上个?月/.test(
      question,
    )
  ) {
    let month: number | undefined;
    const match = question.match(/(?<!\d)(\d{1,2})月/);
    if (match) {
      month = Number(match[1]);
      if (month < 1 || month > 12)
        throw new EngineQueryError("查询月份须为 1—12 月。");
    }
    const chineseMonth = question.match(
      /(十一|十二|十|一|二|三|四|五|六|七|八|九)月/,
    )?.[1];
    if (chineseMonth)
      month =
        [
          "一",
          "二",
          "三",
          "四",
          "五",
          "六",
          "七",
          "八",
          "九",
          "十",
          "十一",
          "十二",
        ].indexOf(chineseMonth) + 1;
    if (/下个?月|上个?月|本月|这个月/.test(question)) {
      const delta = /下个?月/.test(question)
        ? 1
        : /上个?月/.test(question)
          ? -1
          : 0;
      const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
      year = shifted.getUTCFullYear();
      month = shifted.getUTCMonth() + 1;
    }
    if (
      month === undefined &&
      !explicitYear &&
      !/全年|每个?月|逐月|月份|哪几?个?月|流月表/.test(question)
    )
      month = m;
    queries.push({
      tool: "list_fortune_periods",
      args: {
        kind: "months",
        year,
        ...(month ? { month } : {}),
        calendar: "solar",
      },
    });
  } else if (/小限|童限/.test(question))
    queries.push({
      tool: "get_horoscope",
      args: {
        scopes: ["decadal", "age"],
        ...(questionYears(question, now)
          ? { dates: questionYears(question, now)!.map(lunarYearStart) }
          : {}),
      },
    });
  else if (/大限表|所有大限|每步大限/.test(question))
    queries.push({ tool: "list_fortune_periods", args: { kind: "decades" } });
  if (
    /三方|四正|夹宫|借星|空宫|飞化|自化|庙旺|亮度|神煞|来因宫/.test(question)
  ) {
    const palace = question.match(
      /命宫|身宫|来因宫|兄弟|夫妻|子女|财帛|疾厄|迁移|仆役|交友|官禄|事业宫|田宅|福德|父母/,
    )?.[0];
    const star = chart.palaces
      .flatMap((p) => p.stars)
      .find((s) => question.includes(s.name))?.name;
    const view = /飞化|自化/.test(question)
      ? "mutagens"
      : /神煞|来因宫/.test(question)
        ? "auxiliary"
        : "relationships";
    queries.push({
      tool: "inspect_chart",
      args: {
        view,
        ...(palace ? { palace } : star ? { star } : { palace: "命宫" }),
      },
    });
  } else if (/命主|身主|生肖|星座|四柱|八字/.test(question))
    queries.push({ tool: "inspect_chart", args: { view: "metadata" } });
  if (/看.*[天地人]盘|[天地人]盘.*(解读|分析|对比)|天地人盘/.test(question)) {
    for (const [name, astroType] of [
      ["天盘", "heaven"],
      ["地盘", "earth"],
      ["人盘", "human"],
    ]) {
      if (question.includes(name) || question.includes("天地人盘"))
        queries.push({ tool: "get_chart_variant", args: { astroType } });
    }
  }
  return queries.slice(0, 3);
}
export function requestedEngineData(
  question: string,
  chart: ZiweiChart,
  now = new Date(),
) {
  try {
    return questionQueries(question, chart, now).map((q) => ({
      query: q,
      data: executeEngineQuery(q.tool, q.args, chart, now),
    }));
  } catch (error) {
    if (error instanceof EngineQueryError) return [{ error: error.message }];
    return [
      {
        error:
          "该日期数据暂时无法计算，请使用查询工具核实，不要假定引擎不支持该时间层。",
      },
    ];
  }
}
