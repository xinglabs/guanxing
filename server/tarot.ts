import { randomInt } from "node:crypto";
import { tarotDeck, tarotSpreads, type TarotReading } from "../src/lib/tarot";
import { StoreError } from "./public-types";
export interface TarotState extends TarotReading {
  _deck?: string[];
  _orientations?: boolean[];
}
export function createTarotState(
  input: Record<string, unknown>,
  rng: (max: number) => number = randomInt,
): TarotState {
  const spread = tarotSpreads.find((s) => s.id === input.spreadId);
  if (
    !spread ||
    typeof input.question !== "string" ||
    !input.question.trim() ||
    input.question.trim().length > 1000 ||
    typeof input.reversedAllowed !== "boolean"
  )
    throw new StoreError(
      400,
      "请填写 1—1000 字的问题，并选择牌阵和正逆位设置。",
    );
  const deck = tarotDeck.map((c) => c.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    version: 1,
    question: input.question.trim(),
    spreadId: spread.id,
    reversedAllowed: input.reversedAllowed,
    status: "selecting",
    selection: [],
    cards: [],
    _deck: deck,
    _orientations: deck.map(
      () => Boolean(input.reversedAllowed) && rng(2) === 1,
    ),
  };
}
export function publicTarot(state: TarotState): TarotReading {
  return {
    version: 1,
    question: state.question,
    spreadId: state.spreadId,
    reversedAllowed: state.reversedAllowed,
    status: state.status,
    selection: state.selection,
    cards: state.cards,
  };
}
export function revealTarot(
  state: TarotState,
  selection: unknown,
): TarotReading {
  const spread = tarotSpreads.find((s) => s.id === state.spreadId)!;
  if (
    !Array.isArray(selection) ||
    selection.length !== spread.positions.length ||
    selection.some((n) => !Number.isInteger(n) || n < 0 || n >= 78) ||
    new Set(selection).size !== selection.length
  )
    throw new StoreError(400, "请选择牌阵所需的不重复卡牌。");
  if (state.status === "revealed") {
    if (JSON.stringify(selection) !== JSON.stringify(state.selection))
      throw new StoreError(409, "这组牌已经揭示，不能修改。请开启新一轮。");
    return publicTarot(state);
  }
  if (state._deck?.length !== 78 || state._orientations?.length !== 78)
    throw new StoreError(409, "牌组数据不完整，请开启新一轮。");
  return {
    ...publicTarot(state),
    status: "revealed",
    selection: [...selection],
    cards: selection.map((index, i) => ({
      cardId: state._deck![index],
      reversed: state._orientations![index],
      position: spread.positions[i],
    })),
  };
}
