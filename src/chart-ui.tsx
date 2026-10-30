import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, Settings2, X } from "lucide-react";
import {
  createChart,
  branches,
  chartConvention,
  palaceDescriptions,
  describePalace,
} from "./lib/chart";
import type { ChartInput, ZiweiChart, Palace } from "./lib/chart";
import { resolveEndpoint, aiPrivacyNote } from "./lib/ai";
import type { AIConfig } from "./lib/ai";

export const hours = [
  "子时 · 23:00–00:59",
  "丑时 · 01:00–02:59",
  "寅时 · 03:00–04:59",
  "卯时 · 05:00–06:59",
  "辰时 · 07:00–08:59",
  "巳时 · 09:00–10:59",
  "午时 · 11:00–12:59",
  "未时 · 13:00–14:59",
  "申时 · 15:00–16:59",
  "酉时 · 17:00–18:59",
  "戌时 · 19:00–20:59",
  "亥时 · 21:00–22:59",
];
const palaceOrder = [5, 6, 7, 8, 4, 9, 3, 10, 2, 1, 0, 11];
const positions = [
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 1],
  [2, 4],
  [3, 1],
  [3, 4],
  [4, 1],
  [4, 2],
  [4, 3],
  [4, 4],
];

export function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "mark small" : "mark"}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="17" />
      <ellipse cx="24" cy="24" rx="8" ry="22" transform="rotate(35 24 24)" />
      <path d="M4 24h40M24 4v40" />
      <path d="m24 16 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="currentColor" />
    </svg>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-top">
          <span className="eyebrow">观星 / {title}</span>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function BirthForm({
  onCreate,
  onClose,
  initial,
  saveToAccount = false,
}: {
  onCreate: (i: ChartInput) => void | Promise<void>;
  onClose: () => void;
  initial: ChartInput;
  saveToAccount?: boolean;
}) {
  const [input, setInput] = useState(initial),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      createChart(input);
      await onCreate(input);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      title="落下你的出生时刻"
      onClose={() => {
        if (!submitting.current) onClose();
      }}
    >
      <div className="form-heading">
        <span className="chapter">01 — 起盘</span>
        <h2>
          每一张星图，
          <br />
          都有自己的起点。
        </h2>
        <p>记下出生的日期与时辰，展开属于你的十二宫。</p>
      </div>
      <form onSubmit={submit} className="birth-form">
        <label>
          如何称呼你 <span>选填</span>
          <input
            placeholder="旅人"
            maxLength={40}
            value={input.name || ""}
            onChange={(e) =>
              setInput((old) => ({ ...old, name: e.target.value }))
            }
          />
        </label>
        <label>
          公历出生日期
          <input
            type="date"
            onInput={(e) => {
              const date = e.currentTarget.value;
              setInput((old) => ({ ...old, date }));
            }}
            min="1900-01-01"
            max="2100-12-31"
            required
            value={input.date}
            onChange={(e) =>
              setInput((old) => ({ ...old, date: e.target.value }))
            }
          />
        </label>
        <label>
          出生时辰
          <select
            value={input.hour}
            onChange={(e) =>
              setInput((old) => ({ ...old, hour: Number(e.target.value) }))
            }
          >
            {hours.map((h, i) => (
              <option key={h} value={i}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>排盘性别</legend>
          <div className="segmented">
            {(["female", "male"] as const).map((g) => (
              <label className={input.gender === g ? "selected" : ""} key={g}>
                <input
                  type="radio"
                  name="gender"
                  value={g}
                  checked={input.gender === g}
                  onChange={() => setInput((old) => ({ ...old, gender: g }))}
                />
                {g === "female" ? "女" : "男"}
                {input.gender === g && <Check size={15} />}
              </label>
            ))}
          </div>
        </fieldset>
        <details className="convention">
          <summary>时辰与排盘口径</summary>
          <p>{chartConvention}</p>
          <p>不确定时辰时，可先查看示例；不同时间会产生不同命盘。</p>
        </details>
        {input.hour === 0 && (
          <p className="inline-note">
            子时跨越两天。如采用 23 点换日规则，请将上方日期选为次日。
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "正在保存星图…" : "展开我的命盘"} <ArrowRight size={18} />
        </button>
        <p className="privacy-line">
          {saveToAccount
            ? "确认排盘后，出生资料与命盘将保存到你的账号，方便下次继续解读。此步骤不会调用模型。"
            : "出生信息仅用于本机排盘，不自动上传或保存。"}
        </p>
      </form>
    </Modal>
  );
}
export function ConnectionForm({
  config,
  keyOnly = false,
  onSave,
  onClose,
}: {
  config: AIConfig;
  keyOnly?: boolean;
  onSave: (c: AIConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config),
    [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      resolveEndpoint(draft.baseUrl);
      if (!draft.apiKey.trim() || !draft.model.trim())
        throw Error("请填写 Key 和模型名称。");
      onSave(draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="模型与 API Key 设置" onClose={onClose}>
      <div className="form-heading">
        <span className="chapter">你的模型，你的选择</span>
        <h2>
          让星图，
          <br />
          多一个解读的视角。
        </h2>
        <p>使用兼容 OpenAI 的模型服务。费用由服务商按你的账户计费。</p>
        <p>可随时从对话区「连接设置」重新打开，修改或清除 Key。</p>
      </div>
      <form className="birth-form" onSubmit={submit}>
        <label>
          服务地址
          <input
            type="url"
            autoComplete="off"
            required
            placeholder="https://api.deepseek.com/v1"
            readOnly={keyOnly}
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
        </label>
        <label>
          模型名称
          <input
            required
            autoComplete="off"
            placeholder="deepseek-chat"
            readOnly={keyOnly}
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </label>
        <label>
          API Key <span>仅本次会话</span>
          <input
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="输入你的密钥"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
        </label>
        <p className="inline-note">
          {keyOnly
            ? "Key 仅在当前页面内存中保留，请求时经本站服务转发给模型服务商。刷新页面后需要重新填写。"
            : aiPrivacyNote}
        </p>
        <p className="privacy-line">
          {keyOnly
            ? "服务地址和模型由管理后台设置。保存后不会自动发起请求。"
            : "服务需要允许浏览器跨域请求（CORS）。保存后不会自动发起请求。"}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          保存本次连接 <Check size={18} />
        </button>
        {config.apiKey && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              onSave({ ...config, apiKey: "" });
              onClose();
            }}
          >
            清除当前密钥
          </button>
        )}
      </form>
    </Modal>
  );
}
function PalaceCell({
  palace,
  selected,
  onClick,
}: {
  palace: Palace;
  selected: boolean;
  onClick: () => void;
}) {
  const majors = palace.stars.filter((s) => s.type === "major");
  return (
    <button
      className={`palace ${selected ? "selected" : ""} ${palace.isMingGong ? "life-palace" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${palace.name}，${branches[palace.branch]}位，${majors.map((s) => s.name).join("、") || "无主星"}`}
    >
      <span className="palace-top">
        <span>
          {palace.name}
          {!palace.name.endsWith("宫") ? "宫" : ""}
        </span>
        <small>{branches[palace.branch]}</small>
      </span>
      <span className="major-stars">
        {majors.length ? (
          majors.map((s) => (
            <span key={s.name}>
              {s.name}
              <em>{s.brightnessRaw}</em>
              {s.siHua && <b className="sihua">{s.siHua}</b>}
            </span>
          ))
        ) : (
          <span className="empty-star">空宫</span>
        )}
      </span>
      <span className="palace-minor">
        {palace.stars
          .filter((s) => s.type !== "major")
          .slice(0, 3)
          .map((s) => s.name)
          .join(" · ")}
      </span>
      <span className="palace-bottom">
        <small>{palace.daXianAge?.join("—")} 岁</small>
        <span>
          {palace.isShenGong ? "身宫" : palace.isMingGong ? "命宫" : "↗"}
        </span>
      </span>
    </button>
  );
}

export function ChartBoard({
  chart,
  selected,
  onSelect,
}: {
  chart: ZiweiChart;
  selected: number;
  onSelect: (branch: number) => void;
}) {
  return (
    <section className="chart-board" aria-label="紫微十二宫命盘">
      {palaceOrder.map((branch, i) => (
        <div
          className="palace-slot"
          style={{ gridRow: positions[i][0], gridColumn: positions[i][1] }}
          key={branch}
        >
          <PalaceCell
            palace={chart.palaces.find((p) => p.branch === branch)!}
            selected={selected === branch}
            onClick={() => onSelect(branch)}
          />
        </div>
      ))}
      <div className="chart-center">
        <Mark />
        <span className="chapter">紫微斗数 · 本命盘</span>
        <h2>{chart.mingZhu}</h2>
        <p>
          命主 {chart.mingZhu} · 身主 {chart.shenZhu}
        </p>
        <div className="pillars">
          {chart.lunarInfo.fourPillars?.map((pillar, i) => (
            <span key={i}>
              <small>{["年", "月", "日", "时"][i]}柱</small>
              {pillar}
            </span>
          ))}
        </div>
        <span className="board-hint">点选宫位，查看星曜</span>
      </div>
    </section>
  );
}
export function PalaceDetail({
  palace,
  onDiscuss,
}: {
  palace: Palace;
  onDiscuss: () => void;
}) {
  return (
    <section className="reader-palace-info" aria-label="所选宫位详情">
      <div>
        <span className="chapter">{branches[palace.branch]}位</span>
        <h3>
          {palace.name}
          {palace.name.endsWith("宫") ? "" : "宫"}
        </h3>
      </div>
      <p>{palaceDescriptions[palace.name]}</p>
      <div className="reader-stars">
        {palace.stars.map((star, i) => (
          <span key={star.name + i}>
            {star.name}
            <small>{star.brightnessRaw}</small>
            {star.siHua && <b>化{star.siHua}</b>}
          </span>
        ))}
      </div>
      <p className="reader-structure">{describePalace(palace)}</p>
      <button className="text-button" onClick={onDiscuss}>
        聊聊这个宫位 <ArrowUpRight size={16} />
      </button>
    </section>
  );
}
