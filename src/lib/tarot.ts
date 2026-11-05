import meanings from "./tarot/meanings.json";

const majors = [
  "愚者",
  "魔术师",
  "女祭司",
  "皇后",
  "皇帝",
  "教皇",
  "恋人",
  "战车",
  "力量",
  "隐者",
  "命运之轮",
  "正义",
  "倒吊人",
  "死神",
  "节制",
  "恶魔",
  "高塔",
  "星星",
  "月亮",
  "太阳",
  "审判",
  "世界",
];
const suits = {
  wands: "权杖",
  cups: "圣杯",
  swords: "宝剑",
  pentacles: "星币",
};
const ranks = [
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
  "侍从",
  "骑士",
  "王后",
  "国王",
];
export const tarotDeck = [
  ...majors.map((name, i) => ({
    id: `major_${String(i).padStart(2, "0")}`,
    name,
    arcana: "大阿卡纳",
  })),
  ...Object.entries(suits).flatMap(([suit, name]) =>
    ranks.map((rank, i) => ({
      id: `${suit}_${i < 10 ? String(i + 1).padStart(2, "0") : ["page", "knight", "queen", "king"][i - 10]}`,
      name: name + rank,
      arcana: name,
    })),
  ),
].map((card) => ({ ...card, ...meanings[card.id as keyof typeof meanings] }));
export const tarotSpreads = [
  {
    id: "single",
    name: "一张指引",
    caption: "给此刻一个清晰的视角",
    positions: ["此刻的提醒"],
  },
  {
    id: "three",
    name: "看清当下",
    caption: "看见现状，也看见下一步",
    positions: ["当前情况", "主要阻碍", "行动建议"],
  },
  {
    id: "choice",
    name: "两种选择",
    caption: "把两条路放在一起看",
    positions: [
      "你所在的位置",
      "选择 A 的机会",
      "选择 A 的挑战",
      "选择 B 的机会",
      "选择 B 的挑战",
    ],
  },
  {
    id: "relationship",
    name: "关系之镜",
    caption: "理解彼此，找到相处的方向",
    positions: [
      "你的状态",
      "对方呈现的状态",
      "关系的连接",
      "需要面对的阻碍",
      "相处建议",
    ],
  },
] as const;
export type TarotSpreadId = (typeof tarotSpreads)[number]["id"];
export interface TarotCard {
  cardId: string;
  reversed: boolean;
  position: string;
}
export interface TarotReading {
  version: 1;
  question: string;
  spreadId: TarotSpreadId;
  reversedAllowed: boolean;
  status: "selecting" | "revealed";
  selection: number[];
  cards: TarotCard[];
}
export function tarotContext(reading: TarotReading) {
  return {
    question: reading.question,
    spread: tarotSpreads.find((s) => s.id === reading.spreadId)?.name,
    cards: reading.cards.map((draw) => {
      const c = tarotDeck.find((c) => c.id === draw.cardId)!;
      return {
        position: draw.position,
        name: c.name,
        orientation: draw.reversed ? "逆位" : "正位",
        keywords: c.keywords,
        meanings: draw.reversed ? c.reversed : c.upright,
      };
    }),
  };
}
