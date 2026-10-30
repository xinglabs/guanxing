import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { ArrowUpRight, Pause, Play, Maximize2, Minimize2 } from "lucide-react";
import {
  createChart,
  sampleInput,
  branches,
  chartConvention,
} from "./lib/chart";
import type { ChartInput } from "./lib/chart";
import type { AIConfig } from "./lib/ai";
import type { SiteMode } from "./ReadingRoom";
import { BirthForm, Mark, Modal } from "./chart-ui";
import CelestialAtmosphere from "./CelestialAtmosphere";
const Workspace = lazy(() => import("./Workspace"));
const ReadingRoom = lazy(() => import("./ReadingRoom"));
function Sky({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let frame = 0,
      width = 0,
      height = 0,
      t = 0,
      last = 0;
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
        ctx.arc(
          s.x + Math.sin(t * 0.17 + s.p) * 3,
          s.y + Math.cos(t * 0.12 + s.p) * 2,
          s.r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if (!paused) {
        const phase = t % 14;
        if (phase > 9 && phase < 10.5) {
          const p = (phase - 9) / 1.5;
          const x = width * (0.73 - p * 0.25),
            y = height * (0.13 + p * 0.19);
          const alpha = Math.sin(p * Math.PI) * 0.65;
          const trail = ctx.createLinearGradient(x, y, x + 95, y - 48);
          trail.addColorStop(0, `rgba(232,221,186,${alpha})`);
          trail.addColorStop(1, "rgba(232,221,186,0)");
          ctx.strokeStyle = trail;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 95, y - 48);
          ctx.stroke();
        }
      }
    };
    const loop = (now: number) => {
      if (!document.hidden && now - last >= 33) {
        t += Math.min((now - (last || now)) / 1000, 0.1);
        last = now;
        draw();
      } else if (document.hidden) last = now;
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
export default function App() {
  const route = () =>
    location.hash.startsWith("#admin")
      ? "admin"
      : location.hash.startsWith("#reading") || location.hash === "#agent"
        ? "reading"
        : "home";
  const [view, setView] = useState<"home" | "reading" | "admin">(route);
  const [mode, setMode] = useState<SiteMode>("checking");
  const [modal, setModal] = useState<"birth" | "about" | null>(null);
  const [input, setInput] = useState<ChartInput>({
    date: "",
    hour: 6,
    gender: "female",
    name: "",
  });
  const [readingBirth, setReadingBirth] = useState<ChartInput | undefined>();
  const [demo, setDemo] = useState(false);
  const [seed, setSeed] = useState(0);
  const [paused, setPaused] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<AIConfig>({
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
  });
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    void fetch("/api/health", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (r) => {
        if (
          r.status === 404 ||
          (r.ok && !r.headers.get("content-type")?.includes("application/json"))
        )
          return "static" as const;
        if (!r.ok) throw Error();
        const data = await r.json();
        return data.ok
          ? data.mode === "public"
            ? ("public" as const)
            : ("local" as const)
          : ("unavailable" as const);
      })
      .then(setMode)
      .catch(() => setMode("unavailable"))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      setView(route());
      if (location.hash.startsWith("#reading")) {
        setReadingBirth(undefined);
        setSeed((v) => v + 1);
      }
    };
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setPaused(mq.matches);
    mq.addEventListener("change", changed);
    return () => mq.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const changed = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (view !== "home" || paused || !matchMedia("(pointer: fine)").matches)
      return;
    let frame = 0,
      x = 0,
      y = 0;
    const move = (e: PointerEvent) => {
      x = (e.clientX / innerWidth - 0.5) * 12;
      y = (e.clientY / innerHeight - 0.5) * 8;
      if (!frame)
        frame = requestAnimationFrame(() => {
          scene.current?.style.setProperty("--scene-x", `${x}px`);
          scene.current?.style.setProperty("--scene-y", `${y}px`);
          frame = 0;
        });
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [view, paused]);
  function navigate(next: "home" | "reading" | "admin") {
    history.pushState(
      null,
      "",
      location.pathname + location.search + (next === "home" ? "" : "#" + next),
    );
    setView(next);
    setModal(null);
    window.scrollTo({ top: 0 });
  }
  function begin(birth?: ChartInput, isDemo = false) {
    if (birth) {
      createChart(birth);
      setInput(birth);
    }
    setReadingBirth(birth);
    setDemo(isDemo);
    setSeed((v) => v + 1);
    navigate("reading");
  }
  function startReading() {
    if (mode === "static") setModal("birth");
    else begin();
  }
  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice("当前浏览器无法进入全屏。");
    }
  }
  if (view === "admin")
    return (
      <Suspense
        fallback={<div className="page-loading">正在打开管理后台…</div>}
      >
        <Workspace initialTab="admin" onExit={() => navigate("home")} />
      </Suspense>
    );
  if (view === "reading")
    return (
      <Suspense fallback={<div className="page-loading">正在展开星图…</div>}>
        <ReadingRoom
          key={seed}
          initialBirth={readingBirth}
          demo={demo}
          mode={mode}
          config={config}
          onConfig={setConfig}
          onExit={() => navigate("home")}
          onAdmin={() => navigate("admin")}
        />
      </Suspense>
    );
  return (
    <div ref={scene} className={`app cover-app ${paused ? "paused" : ""}`}>
      <div className="landscape" />
      <div className="scene-shade" />
      <CelestialAtmosphere paused={paused} />
      <Sky paused={paused} />
      <div className="grain" />
      <header className="site-header">
        <button
          className="brand"
          onClick={() => navigate("home")}
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
          <button className="active" onClick={() => navigate("home")}>
            观星
          </button>
          <button onClick={startReading}>排一张命盘</button>
          <button onClick={() => begin()}>我的解读</button>
          <button onClick={() => setModal("about")}>关于</button>
        </nav>
        <div className="header-tools">
          <button className="cover-enter" onClick={() => begin()}>
            进入观星 <ArrowUpRight size={15} />
          </button>
          <span className="tool-divider" />
          <button
            className="icon-button"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? "开启动效" : "暂停动效"}
            title={paused ? "开启动效" : "暂停动效"}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="icon-button fullscreen-button"
            onClick={() => void toggleFull()}
            aria-label={full ? "退出全屏" : "进入全屏"}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>
      <main className="home">
        <div className="side-note">仰 观 天 文 · 俯 察 自 我</div>
        <div className="hero-copy">
          <h1>
            在星辰之间，
            <br />
            <span>看见自己。</span>
          </h1>
          <p className="hero-description">
            展开你的命盘，
            <br />
            从此刻在意的事聊起。
          </p>
          <div className="hero-actions">
            <button className="primary hero-cta" onClick={startReading}>
              展开我的星图 <ArrowUpRight size={22} />
            </button>
            <button
              className="sample-button"
              onClick={() =>
                mode === "static" ? begin(sampleInput, true) : begin()
              }
            >
              {mode === "static" ? "先看一张示例" : "继续我的解读"}{" "}
              <span>→</span>
            </button>
          </div>
          <div className="hero-footnote">
            {mode === "static"
              ? "本机排盘，无需登录"
              : "登录后，开启属于你的星图与解读"}
          </div>
        </div>
        <Astrolabe paused={paused} />
        <div className="scene-coordinate">
          <span>星移 · 心定</span>
          <small>THE SKY WITHIN</small>
        </div>
        <footer className="home-footer">
          <div className="cover-volume">
            <span>01 / 星图与人</span>
            <p>
              星象给你一个视角，
              <br />
              人生始终由你书写。
            </p>
          </div>
          <div className="cover-footer-links">
            <button onClick={() => setModal("about")}>
              观星手记 <ArrowUpRight size={14} />
            </button>
            <a
              href="https://xinglabs.github.io/"
              target="_blank"
              rel="noreferrer"
            >
              XINGLABS ↗
            </a>
            <button
              className="cover-admin-link"
              onClick={() => navigate("admin")}
            >
              站点管理
            </button>
          </div>
        </footer>
      </main>
      {modal === "birth" && (
        <BirthForm
          initial={input}
          onCreate={(birth) => begin(birth)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "about" && (
        <Modal title="关于观星" onClose={() => setModal(null)}>
          <div className="form-heading">
            <span className="chapter">XINGLABS / 第一件公开作品</span>
            <h2>观天，也观己。</h2>
            <p>一张真实排出的紫微命盘，和一段可以自由展开的对话。</p>
          </div>
          <div className="about-content">
            <h3>星图如何得来</h3>
            <p>
              排盘基于 Renhuai123/ziwei-doushu 的开源引擎，底层为
              iztro。十二宫与星曜由确定性算法生成，AI
              围绕实际盘面解释，不改写星曜。
            </p>
            <p>{chartConvention}</p>
            <h3>你的信息留在哪里</h3>
            <p>
              出生资料先在浏览器中用于排盘。服务器版在你确认排盘后保存命盘，后续对话和你确认的事也保存在自己的账号中；解读时，相关上下文会交给网站配置的
              AI 服务。静态演示版的对话与连接密钥只保留在当前页面。
            </p>
            <h3>把答案，带回生活</h3>
            <p>解读用于传统文化学习及娱乐，不声称能够科学预测人生。</p>
            <a
              className="text-button"
              href="https://github.com/xinglabs/guanxing"
              target="_blank"
              rel="noreferrer"
            >
              查看开源代码 <ArrowUpRight size={16} />
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
