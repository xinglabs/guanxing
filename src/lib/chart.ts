import { generateChart, setBrightnessSchool } from "./ziwei/algorithm";
import { BRANCHES } from "./ziwei/constants";
import type { Palace, ZiweiChart } from "./ziwei/types";

export type { ZiweiChart, Palace, Star } from "./ziwei/types";

export interface ChartInput {
  /** 公历排盘日，严格 YYYY-MM-DD。 */
  date: string;
  /** 地支时辰序号 0–11，不是 24 小时制钟点。 */
  hour: number;
  gender: "male" | "female";
  name?: string;
}

export const branches = [...BRANCHES];
export const sampleInput: ChartInput = {
  date: "1995-08-17",
  hour: 4,
  gender: "female",
  name: "示例命盘",
};
export const chartConvention =
  "公历 · 按时辰排盘 · 全书亮度表 · 闰月分半。未校正真太阳时或夏令时。子时序号为 0；如按晚子时换日口径，23 点出生请将排盘日期选为次日。";

export function createChart(input: ChartInput): ZiweiChart {
  if (
    !input ||
    typeof input.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
  ) {
    throw new RangeError("请填写完整的公历日期。");
  }
  const [year, month, day] = input.date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2100 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError("请输入 1900—2100 年之间真实存在的公历日期。");
  }
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 11) {
    throw new RangeError("请选择有效时辰（子时至亥时）。");
  }
  if (input.gender !== "male" && input.gender !== "female") {
    throw new RangeError("请选择排盘使用的性别。");
  }
  if (
    input.name !== undefined &&
    (typeof input.name !== "string" || input.name.length > 40)
  ) {
    throw new RangeError("称呼请保持在 40 字以内。");
  }
  // Reset the upstream module's mutable brightness setting for consistent results.
  setBrightnessSchool("default");
  return generateChart(
    {
      year,
      month,
      day,
      hour: input.hour,
      gender: input.gender,
      name: input.name?.trim(),
    },
    { leapMonth: "split" },
  );
}

/** Original, explanatory copy: these labels describe chart conventions, not predictions. */
export const palaceDescriptions: Record<string, string> = {
  命宫: "命盘的观察起点，传统上用来讨论个性与处事方式。可以把它当成一组认识自己的提问。",
  兄弟: "传统上观察手足与平辈相处的宫位。现实关系仍由具体经历和沟通形成。",
  夫妻: "传统上观察亲密关系的宫位，可用来整理自己的相处需求与边界。",
  子女: "传统上讨论子女及教养关系。这里不推断生育能力、孩子数量或健康。",
  财帛: "传统上讨论资源与金钱习惯。星曜不是收益预测，也不提供买卖建议。",
  疾厄: "传统命盘中的健康宫位。本页只展示排盘结构，不据此判断疾病或寿命。",
  迁移: "传统上观察外出、环境变化与适应方式，可结合真实经历作自我回顾。",
  仆役: "也常称交友宫，传统上观察朋友、伙伴与合作关系。",
  官禄: "也常称事业宫，传统上讨论工作方式与投入方向，不代表职业成败已定。",
  田宅: "传统上讨论居所、家庭空间与归属感，不用于预测资产价格。",
  福德: "传统上观察内在感受、兴趣和休息方式，是自我照顾的一个话题入口。",
  父母: "传统上讨论长辈与成长环境。不能凭命盘断言他人的经历或处境。",
};

export function describePalace(palace: Palace): string {
  const majors = palace.stars
    .filter((star) => star.type === "major")
    .map((star) => star.name);
  const position = `${palace.name}位于${branches[palace.branch]}位`;
  if (majors.length)
    return `${position}，主星为${majors.join("、")}。这是算法生成的排盘结构，不是 AI 判断。`;
  const borrowed = palace.borrowedStars?.join("、");
  return `${position}，本宫无主星${borrowed ? `，传统上可参照对宫的${borrowed}` : ""}。空宫不是缺失，也不代表吉凶。`;
}
