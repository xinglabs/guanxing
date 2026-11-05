import test from "node:test";
import assert from "node:assert/strict";
import {
  appendConversationDraft,
  conversationPrompts,
  quoteQuestion,
} from "../src/lib/conversation";

test("continuation never erases an unsent draft or silently truncates a long question", () => {
  assert.equal(
    appendConversationDraft("我补充一下：现在在创业。", "具体怎么做？"),
    "我补充一下：现在在创业。\n\n具体怎么做？",
  );
  assert.equal(appendConversationDraft("", "继续聊"), "继续聊");
  assert.equal(appendConversationDraft("a".repeat(5999), "继续聊"), null);
  assert.equal(appendConversationDraft("a".repeat(5899), "继续聊", 5900), null);
});

test("quote composition preserves the selected words and bounds long copied passages", () => {
  assert.equal(
    quoteQuestion("  更适合积累经验，\n而不是频繁换方向。 "),
    "你刚才说「更适合积累经验， 而不是频繁换方向。」，这句话具体怎么理解？",
  );
  assert.equal(quoteQuestion("  "), "");
  assert.ok(quoteQuestion("星".repeat(1000)).length < 440);
  assert.ok(quoteQuestion("<script>alert(1)</script>").includes("<script>")); // Kept as text, never HTML.
});

test("contextual continuation keeps tarot separate from birth-chart requirements", () => {
  const tarot = conversationPrompts("tarot", "我在纠结两种选择");
  assert.match(tarot[0].question, /牌位和正逆位/);
  assert.ok(!tarot.some((p) => /出生|命盘|运限/.test(p.question)));
  assert.equal(tarot[2].label, "换条路会怎样");
  assert.equal(
    conversationPrompts("ziwei", "今年适合换工作吗")[2].label,
    "机会和代价",
  );
  assert.equal(
    conversationPrompts("tarot", "关系怎么相处")[2].label,
    "相处怎么调整",
  );
  assert.equal(
    conversationPrompts("ziwei", "简单说说")[2].label,
    "举个生活例子",
  );
});
