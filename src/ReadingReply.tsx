import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Quote, X } from "lucide-react";
import ReadingText from "./ReadingText";
import {
  conversationPrompts,
  quoteQuestion,
  type ReadingKind,
} from "./lib/conversation";
import "./reading-reply.css";

/** Only assists composition. Sending always stays with the existing quota-controlled flow. */
export default function ReadingReply({
  text,
  kind,
  question,
  latest,
  disabled,
  onDraft,
}: {
  text: string;
  kind: ReadingKind;
  question: string;
  latest: boolean;
  disabled: boolean;
  onDraft: (question: string) => void;
}) {
  const prose = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState("");
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    const selectionChanged = () => {
      const s = window.getSelection();
      if (
        s &&
        !s.isCollapsed &&
        prose.current?.contains(s.anchorNode) &&
        prose.current.contains(s.focusNode)
      )
        setQuote(s.toString().trim().slice(0, 400));
      else setQuote("");
    };
    document.addEventListener("selectionchange", selectionChanged);
    return () =>
      document.removeEventListener("selectionchange", selectionChanged);
  }, []);
  function askQuote(value: string) {
    const question = quoteQuestion(value);
    if (question && !disabled) onDraft(question);
    setChoosing(false);
    setQuote("");
  }
  const passages = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(?:#{1,6}[^\n]*|[-*_]{3,})$/.test(p));
  return (
    <div className="reading-reply">
      <div ref={prose}>
        <ReadingText text={text} />
      </div>
      {quote && !disabled && (
        <button
          type="button"
          className="reply-selected"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => askQuote(quote)}
        >
          <Quote size={14} /> 就选中这句话聊聊 <ArrowUpRight size={14} />
        </button>
      )}
      <div className="reply-tools">
        {latest && <span>接着聊</span>}
        {latest &&
          conversationPrompts(kind, question).map((p) => (
            <button
              type="button"
              key={p.label}
              disabled={disabled}
              onClick={() => onDraft(p.question)}
            >
              {p.label}
              <ArrowUpRight size={12} />
            </button>
          ))}
        <button
          type="button"
          disabled={disabled}
          aria-expanded={choosing}
          onClick={() => setChoosing((v) => !v)}
        >
          {choosing ? <X size={13} /> : <Quote size={13} />}
          {choosing ? "收起" : "选一段细聊"}
        </button>
      </div>
      {choosing && (
        <div className="reply-passages" aria-label="选择要追问的段落">
          <small>选一段放进输入框，也可以直接选中文字。</small>
          {passages.map((p, i) => (
            <button
              type="button"
              key={i}
              disabled={disabled}
              onClick={() => askQuote(p)}
            >
              <span>
                {p.replace(/[*#]/g, "").slice(0, 120)}
                {p.length > 120 ? "…" : ""}
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}
      {latest && (
        <small className="reply-draft-note">
          点选后可修改，也可以直接写下你的想法。
        </small>
      )}
    </div>
  );
}
