import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  X,
  Pause,
  Play,
  Maximize2,
  Minimize2,
  Settings2,
  Download,
  RotateCcw,
  Check,
  LoaderCircle,
} from "lucide-react";
import {
  createChart,
  sampleInput,
  branches,
  chartConvention,
  palaceDescriptions,
  describePalace,
} from "./lib/chart";
import type { ChartInput, ZiweiChart, Palace } from "./lib/chart";
import { readChart, resolveEndpoint, aiPrivacyNote } from "./lib/ai";
import type { AIConfig } from "./lib/ai";

const hours = [
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
const topics = ["认识自己", "事业与方向", "关系与相处", "内在与成长"];
const questions: Record<string, string> = {
  认识自己:
    "请依据命宫、身宫和相关星曜，解读我的性格与处事方式，并提出值得自我观察的问题。",
  事业与方向:
    "请依据官禄、命宫和迁移宫，谈谈适合自我探索的工作方式与成长方向。",
  关系与相处:
    "请依据夫妻、交友与命宫，谈谈亲密关系中的沟通习惯和需要自我观察的地方。",
  内在与成长:
    "请依据福德和命宫，谈谈内在需求、休息方式与可实践的自我成长方向。",
};
function Mark({ small = false }: { small?: boolean }) {
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
function Sky({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let frame = 0,
      width = 0,
      height = 0,
      t = 0;
    let stars: { x: number; y: number; r: number; p: number }[] = [];
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      el.width = width * ratio;
      el.height = height * ratio;
      el.style.width = width + "px";
      el.style.height = height + "px";
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      stars = Array.from(
        { length: Math.min(100, Math.floor(width / 12)) },
        (_, i) => ({
          x: ((((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1) * width,
          y:
            ((((Math.sin(i * 269.5) * 43758.5453) % 1) + 1) % 1) *
            height *
            0.78,
          r: i % 9 === 0 ? 1.3 : 0.55,
          p: i * 1.37,
        }),
      );
      draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(229,224,201,${0.25 + (0.5 * (Math.sin(t + s.p) + 1)) / 2})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = () => {
      if (!document.hidden) {
        t += 0.008;
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    resize();
    if (!paused) frame = requestAnimationFrame(loop);
    addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
    };
  }, [paused]);
  return <canvas ref={ref} className="sky" aria-hidden="true" />;
}
function Astrolabe({ paused }: { paused: boolean }) {
  return (
    <div className={`astrolabe ${paused ? "still" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 640 640">
        <defs>
          <radialGradient id="glow">
            <stop stopColor="#d3bd8e" stopOpacity=".22" />
            <stop offset="1" stopColor="#c2b696" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="320" cy="320" r="280" fill="url(#glow)" />
        <g className="wheel outer">
          <circle cx="320" cy="320" r="284" />
          <circle cx="320" cy="320" r="276" />
          <circle cx="320" cy="320" r="240" />
          {Array.from({ length: 120 }, (_, i) => {
            const a = (i * Math.PI) / 60;
            const r = i % 10 === 0 ? 259 : i % 5 === 0 ? 266 : 271;
            return (
              <path
                key={i}
                d={`M${320 + Math.cos(a) * r},${320 + Math.sin(a) * r}L${320 + Math.cos(a) * 276},${320 + Math.sin(a) * 276}`}
                opacity={i % 5 === 0 ? 0.8 : 0.35}
              />
            );
          })}
          {branches.map((b, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return (
              <text
                key={b}
                x={320 + Math.cos(a) * 251}
                y={327 + Math.sin(a) * 251}
                textAnchor="middle"
                transform={`rotate(${i * 30} ${320 + Math.cos(a) * 251} ${320 + Math.sin(a) * 251})`}
              >
                {b}
              </text>
            );
          })}
        </g>
        <g className="wheel inner">
          <circle cx="320" cy="320" r="221" />
          <circle cx="320" cy="320" r="196" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return (
              <path
                key={i}
                d={`M${320 + Math.cos(a) * 110},${320 + Math.sin(a) * 110}L${320 + Math.cos(a) * 221},${320 + Math.sin(a) * 221}`}
              />
            );
          })}
          <path
            d="M320 110 502 425 138 425Z M320 530 138 215 502 215Z"
            opacity=".35"
          />
          <circle cx="320" cy="320" r="110" />
          <circle cx="320" cy="320" r="103" />
        </g>
        <g className="constellation">
          <path d="M220 196 275 234 303 299 356 302 390 351 459 374 486 422" />
          {[
            [220, 196],
            [275, 234],
            [303, 299],
            [356, 302],
            [390, 351],
            [459, 374],
            [486, 422],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={i === 2 ? 5 : 3} />
              <circle className="star-halo" cx={x} cy={y} r="11" />
            </g>
          ))}
        </g>
        <circle cx="320" cy="320" r="17" />
        <path d="M320 295v50M295 320h50" />
      </svg>
      <span className="orbit-note one">紫微垣</span>
      <span className="orbit-note two">
        天枢 <i /> 天璇
      </span>
      <span className="orbit-caption">一瞬的星辰，一生的回响</span>
    </div>
  );
}
function Modal({
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
function BirthForm({
  onCreate,
  onClose,
  initial,
}: {
  onCreate: (i: ChartInput) => void;
  onClose: () => void;
  initial: ChartInput;
}) {
  const [input, setInput] = useState(initial),
    [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      createChart(input);
      onCreate(input);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="落下你的出生时刻" onClose={onClose}>
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
            onChange={(e) => setInput({ ...input, name: e.target.value })}
          />
        </label>
        <label>
          公历出生日期
          <input
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            required
            value={input.date}
            onChange={(e) => setInput({ ...input, date: e.target.value })}
          />
        </label>
        <label>
          出生时辰
          <select
            value={input.hour}
            onChange={(e) =>
              setInput({ ...input, hour: Number(e.target.value) })
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
                  onChange={() => setInput({ ...input, gender: g })}
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
        <button type="submit" className="primary">
          展开我的命盘 <ArrowRight size={18} />
        </button>
        <p className="privacy-line">
          出生信息仅用于本机排盘，不自动上传或保存。
        </p>
      </form>
    </Modal>
  );
}
function Settings({
  config,
  onSave,
  onClose,
}: {
  config: AIConfig;
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
    <Modal title="连接你的模型" onClose={onClose}>
      <div className="form-heading">
        <span className="chapter">你的模型，你的选择</span>
        <h2>
          让星图，
          <br />
          多一个解读的视角。
        </h2>
        <p>使用兼容 OpenAI 的模型服务。费用由服务商按你的账户计费。</p>
      </div>
      <form className="birth-form" onSubmit={submit}>
        <label>
          服务地址
          <input
            type="url"
            autoComplete="off"
            required
            placeholder="https://api.deepseek.com/v1"
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
        <p className="inline-note">{aiPrivacyNote}</p>
        <p className="privacy-line">
          服务需要允许浏览器跨域请求（CORS）。保存后不会自动发起请求。
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
function Report({ text }: { text: string }) {
  return (
    <div className="report">
      {text
        .split("\n")
        .filter(Boolean)
        .map((line, i) =>
          /^#{1,4}\s/.test(line) ? (
            <h4 key={i}>{line.replace(/^#+\s/, "")}</h4>
          ) : (
            <p key={i}>{line.replace(/\*\*(.*?)\*\*/g, "$1")}</p>
          ),
        )}
    </div>
  );
}
export default function App() {
  const [view, setView] = useState<"home" | "chart">("home"),
    [modal, setModal] = useState<"birth" | "settings" | "about" | null>(null);
  const [input, setInput] = useState<ChartInput>({
      date: "",
      hour: 6,
      gender: "female",
      name: "",
    }),
    [chart, setChart] = useState<ZiweiChart | null>(null),
    [demo, setDemo] = useState(false),
    [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [full, setFull] = useState(false),
    [notice, setNotice] = useState("");
  const [config, setConfig] = useState<AIConfig>({
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
  });
  const [tab, setTab] = useState<"palace" | "reading">("palace"),
    [topic, setTopic] = useState(topics[0]),
    [question, setQuestion] = useState(""),
    [reading, setReading] = useState(""),
    [readingModel, setReadingModel] = useState(""),
    [busy, setBusy] = useState(false),
    [aiError, setAiError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const change = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setPaused(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  const generate = (birth: ChartInput, isDemo = false) => {
    const result = createChart(birth);
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setInput(birth);
    setChart(result);
    setSelected(result.mingGongBranch);
    setDemo(isDemo);
    setView("chart");
    setModal(null);
    setReading("");
    setAiError("");
    setTab("palace");
    window.scrollTo({ top: 0 });
  };
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else setNotice("当前浏览器不支持全屏，页面已使用全部可用空间。");
    } catch {
      setNotice("当前浏览器未能进入全屏。");
    }
  };
  const startReading = async () => {
    if (!chart) return;
    if (!config.apiKey) {
      setModal("settings");
      return;
    }
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setAiError("");
    setReading("");
    try {
      const result = await readChart(
        chart,
        config,
        question.trim() || questions[topic],
        active.signal,
      );
      if (controller.current === active) {
        setReading(result);
        setReadingModel(config.model);
      }
    } catch (e) {
      if (controller.current === active) setAiError((e as Error).message);
    } finally {
      if (controller.current === active) {
        setBusy(false);
        controller.current = null;
      }
    }
  };
  const download = () => {
    if (!chart) return;
    const text =
      `观星 · 紫微\n${demo ? "示例命盘" : input.name || "旅人"}\n${input.date} · ${hours[input.hour]} · ${input.gender === "female" ? "女" : "男"}\n${chartConvention}\n\n` +
      chart.palaces
        .map(
          (p) =>
            `${p.name}（${branches[p.branch]}）\n${p.stars.map((s) => `${s.name}${s.brightnessRaw ? " · " + s.brightnessRaw : ""}${s.siHua ? " · 化" + s.siHua : ""}`).join("，")}`,
        )
        .join("\n\n") +
      (reading ? `\n\nAI 解读 · ${readingModel}\n${reading}` : "") +
      "\n\n传统文化与自我探索，不作为现实决策依据。\nhttps://github.com/xinglabs/guanxing";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `观星-${input.date}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("命盘已导出为文字文件。");
  };
  const current = chart?.palaces.find((p) => p.branch === selected);
  return (
    <div
      className={`app ${paused ? "paused" : ""} ${view === "chart" ? "chart-view" : ""}`}
    >
      <div className="landscape" />
      <div className="scene-shade" />
      <Sky paused={paused} />
      <div className="grain" />
      <header className="site-header">
        <button
          className="brand"
          onClick={() => setView("home")}
          aria-label="观星首页"
        >
          <Mark />
          <span>
            观星<span className="brand-divider">/</span>
            <em>紫微</em>
            <small>GUANXING</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => setView("home")}
          >
            观星台
          </button>
          <button
            className={view === "chart" ? "active" : ""}
            onClick={() => (chart ? setView("chart") : setModal("birth"))}
          >
            我的命盘
          </button>
          <button onClick={() => setModal("about")}>关于观星</button>
        </nav>
        <div className="header-tools">
          <a
            className="lab-link"
            href="https://xinglabs.github.io/"
            target="_blank"
            rel="noreferrer"
          >
            XINGLABS <ArrowUpRight size={14} />
          </a>
          <span className="tool-divider" />
          <button
            className="icon-button"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "开启动效" : "暂停动效"}
            title={paused ? "开启动效" : "暂停动效"}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="icon-button fullscreen-button"
            onClick={toggleFull}
            aria-label={full ? "退出全屏" : "进入全屏"}
            title="全屏"
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>
      {view === "home" ? (
        <main className="home">
          <div className="side-note">仰 观 天 文 · 俯 察 自 我</div>
          <div className="hero-copy">
            <div className="intro-line">
              <span className="little-star">✦</span>
              <span>东方星象，一种认识自己的方式</span>
            </div>
            <h1>
              在星辰之间，
              <br />
              <span>看见自己。</span>
            </h1>
            <p className="hero-description">
              把出生的那一刻，化作一张星图。
              <br />
              从十二宫的交汇处，读懂性情、关系与人生的可能。
            </p>
            <div className="hero-actions">
              <button
                className="primary hero-cta"
                onClick={() => setModal("birth")}
              >
                开启我的星图 <ArrowUpRight size={22} />
              </button>
              <button
                className="sample-button"
                onClick={() => generate(sampleInput, true)}
              >
                先看一张示例 <span>→</span>
              </button>
            </div>
            <div className="hero-footnote">
              <span className="dot" /> 本机排盘 <i /> 无需注册 <i /> 可连接你的
              AI
            </div>
          </div>
          <Astrolabe paused={paused} />
          <div className="scene-coordinate">
            <span>星移 · 心定</span>
            <small>THE SKY WITHIN</small>
          </div>
          <footer className="home-footer">
            <div className="edition">
              <span>一</span>
              <div>
                观星手记<small>第一卷 · 紫微斗数</small>
              </div>
            </div>
            <p>
              星象给你一个视角，
              <br />
              <span>人生始终由你书写。</span>
            </p>
            <button className="footer-link" onClick={() => setModal("about")}>
              从古老星图，到当下的你 <ArrowRight size={18} />
            </button>
          </footer>
        </main>
      ) : (
        chart && (
          <main className="chart-main">
            <div className="chart-heading">
              <div>
                <button className="back-link" onClick={() => setView("home")}>
                  <ArrowLeft size={14} /> 返回观星台
                </button>
                <h1>
                  {demo ? "一张星图的展开" : `${input.name || "旅人"}的星图`}
                  {demo && <span>示例</span>}
                </h1>
                <p>
                  {input.date.replaceAll("-", " / ")} <i />{" "}
                  {hours[input.hour].split(" · ")[0]} <i />{" "}
                  {chart.yinYangGender} <i /> {chart.wuxingJuName}
                </p>
              </div>
              <div className="chart-actions">
                <button
                  className="outline-button"
                  onClick={() => setModal("birth")}
                >
                  <RotateCcw size={15} /> 重新排盘
                </button>
                <button
                  className="icon-button"
                  onClick={download}
                  aria-label="导出命盘"
                  title="导出命盘"
                >
                  <Download size={18} />
                </button>
              </div>
            </div>
            <div className="chart-workspace">
              <section className="chart-board" aria-label="紫微十二宫命盘">
                {palaceOrder.map((branch, i) => {
                  const p = chart.palaces.find((p) => p.branch === branch)!;
                  return (
                    <div
                      className="palace-slot"
                      style={{
                        gridRow: positions[i][0],
                        gridColumn: positions[i][1],
                      }}
                      key={branch}
                    >
                      <PalaceCell
                        palace={p}
                        selected={selected === branch}
                        onClick={() => {
                          setSelected(branch);
                          setTab("palace");
                        }}
                      />
                    </div>
                  );
                })}
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
                  <span className="board-hint">点选一宫，慢慢读懂</span>
                </div>
              </section>
              <aside className="reading-panel">
                <div className="panel-tabs" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === "palace"}
                    onClick={() => setTab("palace")}
                  >
                    十二宫细读
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "reading"}
                    onClick={() => setTab("reading")}
                  >
                    AI 解读{" "}
                    <span
                      className={
                        config.apiKey ? "connection connected" : "connection"
                      }
                    />
                  </button>
                </div>
                {tab === "palace" && current ? (
                  <div className="palace-detail" role="tabpanel">
                    <span className="chapter">
                      {branches[current.branch]}位 /{" "}
                      {current.isMingGong
                        ? "命宫所在"
                        : current.isShenGong
                          ? "身宫所在"
                          : "十二人生切面"}
                    </span>
                    <h2>
                      {current.name}
                      {!current.name.endsWith("宫") ? "宫" : ""}
                      <span>
                        {current.stars
                          .filter((s) => s.type === "major")
                          .map((s) => s.name)
                          .join(" · ") || "无主星"}
                      </span>
                    </h2>
                    <p>
                      {palaceDescriptions[current.name] ||
                        "从这个宫位观察命盘中不同星曜的关系。"}
                    </p>
                    <div className="star-list">
                      {current.stars.map((star, i) => (
                        <div key={star.name + i}>
                          <span>
                            {star.name}
                            <small>
                              {star.type === "major"
                                ? "主星"
                                : star.type === "lucky"
                                  ? "吉曜"
                                  : star.type === "sha"
                                    ? "煞曜"
                                    : "辅曜"}
                            </small>
                          </span>
                          <span>
                            {star.brightnessRaw || "—"}
                            {star.siHua && (
                              <b className="sihua">化{star.siHua}</b>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="structure-note">{describePalace(current)}</p>
                    <button
                      className="text-button read-link"
                      onClick={() => setTab("reading")}
                    >
                      借助 AI，再读深一点 <ArrowUpRight size={18} />
                    </button>
                  </div>
                ) : (
                  <div className="ai-panel" role="tabpanel">
                    <div className="ai-intro">
                      <span className="chapter">多一种理解自己的可能</span>
                      <h2>你想了解什么？</h2>
                      <button
                        className="model-settings"
                        onClick={() => setModal("settings")}
                      >
                        <Settings2 size={14} />
                        {config.apiKey ? config.model : "连接你的模型"}
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="topics">
                      {topics.map((t) => (
                        <button
                          key={t}
                          className={topic === t ? "selected" : ""}
                          onClick={() => setTopic(t)}
                          disabled={busy}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <label className="question-label" htmlFor="question">
                      也可以写下此刻的问题 <span>选填</span>
                    </label>
                    <textarea
                      id="question"
                      maxLength={1000}
                      placeholder="比如：我在合作中，容易忽略什么？"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={busy}
                    />
                    <p className="ai-consent">
                      点击解读，将命盘星曜与问题发送到{" "}
                      {(() => {
                        try {
                          return new URL(config.baseUrl).hostname;
                        } catch {
                          return "你配置的服务";
                        }
                      })()}
                      。不附带称呼及完整生日。
                    </p>
                    {busy ? (
                      <button
                        className="primary"
                        onClick={() => controller.current?.abort()}
                      >
                        <LoaderCircle className="spin" size={17} /> 正在解读 ·
                        点击停止
                      </button>
                    ) : (
                      <button className="primary" onClick={startReading}>
                        {config.apiKey ? "开始 AI 解读" : "连接模型，开始解读"}
                        <ArrowUpRight size={18} />
                      </button>
                    )}
                    <div aria-live="polite">
                      {aiError && (
                        <p className="error" role="alert">
                          {aiError}
                        </p>
                      )}
                      {reading && (
                        <>
                          <div className="report-label">
                            本次解读 <span>由 {readingModel} 生成</span>
                          </div>
                          <Report text={reading} />
                          <button className="text-button" onClick={download}>
                            <Download size={15} /> 保存这份解读
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </div>
            <footer className="chart-footer">
              <p>
                按时辰排盘 · 未校正真太阳时{" "}
                <button onClick={() => setModal("about")}>查看口径 ↗</button>
              </p>
              <span>传统文化与自我探索，不作为现实决策依据。</span>
            </footer>
          </main>
        )
      )}
      {modal === "birth" && (
        <BirthForm
          initial={input}
          onCreate={(i) => generate(i)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "settings" && (
        <Settings
          config={config}
          onSave={(c) => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            setConfig(c);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "about" && (
        <Modal title="关于观星" onClose={() => setModal(null)}>
          <div className="form-heading">
            <span className="chapter">XINGLABS / 第一件公开作品</span>
            <h2>观天，也观己。</h2>
            <p>
              观星将传统紫微斗数，变成一段可以亲手探索的体验。它提供一个自我观察的视角，不声称能科学预测人生。
            </p>
          </div>
          <div className="about-content">
            <h3>星图如何得来</h3>
            <p>
              排盘使用 Renhuai123/ziwei-doushu 的开源引擎，底层为
              iztro。十二宫与星曜由确定性算法生成；AI 只负责解读，不改写命盘。
            </p>
            <p>{chartConvention}</p>
            <h3>你的信息留在哪里</h3>
            <p>
              出生信息在浏览器中计算。页面不使用分析追踪，不保存历史命盘。只有主动请求
              AI
              时，才会向你填写的服务地址发送命盘星曜与问题。密钥仅保存在内存里。
            </p>
            <h3>愿你把答案，带回生活</h3>
            <p>
              命盘与 AI
              内容仅用于传统文化学习及娱乐。现实中的关系、职业与健康，需要真实的信息、沟通和行动。
            </p>
            <a
              className="text-button"
              href="https://github.com/xinglabs/guanxing"
              target="_blank"
              rel="noreferrer"
            >
              查看开源代码 <ArrowUpRight size={17} />
            </a>
            <a
              className="text-button"
              href="https://github.com/Renhuai123/ziwei-doushu"
              target="_blank"
              rel="noreferrer"
            >
              排盘引擎来源 <ArrowUpRight size={17} />
            </a>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
