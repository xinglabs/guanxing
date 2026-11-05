export type ReadingKind = "ziwei" | "tarot";
export interface ConversationPrompt {
  label: string;
  question: string;
}

/** Local navigation aids, never model output or an automatic extra request. */
export function conversationPrompts(
  kind: ReadingKind,
  question: string,
): ConversationPrompt[] {
  const basis =
    kind === "tarot" ? "这组牌的牌位和正逆位" : "这张命盘和相关运限";
  const options: ConversationPrompt[] = [
    {
      label: "为什么这样看",
      question: `你刚才这个判断，最主要是从${basis}的哪里看出来的？把依据和推论分开，用大白话说。`,
    },
    {
      label: "具体怎么做",
      question:
        "接着刚才的问题，给我一个现在能做的具体步骤，也说说什么情况下需要换个做法。",
    },
  ];
  if (/工作|事业|职业|跳槽|转职|升职|创业|offer/i.test(question))
    options.push({
      label: "机会和代价",
      question:
        "继续聊刚才的工作问题，机会和要付出的代价分别是什么？结合已有信息说明，不用重讲整份解读。",
    });
  else if (/感情|关系|恋爱|伴侣|婚|复合|相处/.test(question))
    options.push({
      label: "相处怎么调整",
      question:
        "就刚才这段关系的解读，具体说一个我可以调整的相处方式。不要替对方断定真实想法。",
    });
  else if (/选择|纠结|两条路|选项/.test(question))
    options.push({
      label: "换条路会怎样",
      question:
        "把刚才提到的两种选择放在一起比较，哪一点最值得我权衡？如果没有具体选项，先说明能比较到哪一步，不替我编造。",
    });
  else
    options.push({
      label: "举个生活例子",
      question:
        "用一个生活中的例子，解释刚才最关键的判断。例子请作为假设，不要当作我已经发生的事。",
    });
  return options;
}

export function quoteQuestion(text: string): string {
  const quote = text.trim().replace(/\s+/g, " ").slice(0, 400);
  return quote ? `你刚才说「${quote}」，这句话具体怎么理解？` : "";
}

/** Preserve the user's unsent words; never silently truncate or submit them. */
export function appendConversationDraft(
  draft: string,
  addition: string,
  limit = 6000,
): string | null {
  const next = draft.trim() ? `${draft.trimEnd()}\n\n${addition}` : addition;
  return next.length <= limit ? next : null;
}
