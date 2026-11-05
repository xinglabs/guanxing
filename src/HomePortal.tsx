import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowDown,
  Pause,
  Play,
  Maximize2,
  Minimize2,
  History,
} from "lucide-react";
import { Mark } from "./chart-ui";
import { workspaceApi as api, type Session } from "./workspace-api";
import type { SiteMode } from "./ReadingRoom";
import "./home-portal.css";

function ContinueReading({
  mode,
  onAdmin,
}: {
  mode: SiteMode;
  onAdmin: () => void;
}) {
  const [recent, setRecent] = useState<Session[]>([]);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (mode !== "public") return;
    let live = true;
    const controller = new AbortController();
    void api
      .health(controller.signal)
      .then(async (health) => {
        if (!live || !health.authenticated) return;
        if (health.user?.role === "admin") {
          setAdmin(true);
          return;
        }
        const { sessions } = await api.sessions();
        if (!live) return;
        const chart = sessions.find((s) => !s.tarot && s.birth);
        const tarot = sessions.find((s) => s.tarot);
        setRecent([chart, tarot].filter((s): s is Session => !!s));
      })
      .catch(() => {
        /* The main entry points remain available if a session expires. */
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [mode]);
  if (admin)
    return (
      <div className="portal-resume">
        <span>你已登录系统管理员账号</span>
        <button onClick={onAdmin}>
          进入管理后台 <ArrowUpRight size={16} />
        </button>
      </div>
    );
  if (!recent.length) return null;
  return (
    <section className="portal-resume" aria-label="继续最近的解读">
      <span>
        <History size={14} /> 接着上次聊
      </span>
      {recent.map((s) => (
        <a key={s.id} href={`#${s.tarot ? "tarot" : "reading"}/${s.id}`}>
          <small>{s.tarot ? "塔罗" : "紫微"}</small>
          <span>{s.tarot?.question || s.title}</span>
          <ArrowUpRight size={15} />
        </a>
      ))}
    </section>
  );
}

export default function HomePortal({
  mode,
  paused,
  full,
  astrolabe,
  onZiwei,
  onTarot,
  onAbout,
  onAdmin,
  onPause,
  onFullscreen,
  onHome,
}: {
  mode: SiteMode;
  paused: boolean;
  full: boolean;
  astrolabe: ReactNode;
  onZiwei: () => void;
  onTarot: () => void;
  onAbout: () => void;
  onAdmin: () => void;
  onPause: () => void;
  onFullscreen: () => void;
  onHome: () => void;
}) {
  return (
    <>
      <header className="portal-header">
        <button className="brand" onClick={onHome} aria-label="观星首页">
          <Mark />
          <span>
            观星<small>GUANXING</small>
          </span>
        </button>
        <span className="portal-brand-note">紫微 · 塔罗 · 对话</span>
        <nav aria-label="主导航">
          <button onClick={onZiwei}>紫微命盘</button>
          <button onClick={onTarot}>塔罗问事</button>
          <a href="#how-it-works">
            怎么玩 <ArrowDown size={12} />
          </a>
        </nav>
        <div className="portal-controls">
          <button
            className="icon-button"
            onClick={onPause}
            aria-label={paused ? "开启动效" : "暂停动效"}
            title={paused ? "开启动效" : "暂停动效"}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            className="icon-button portal-fullscreen"
            onClick={onFullscreen}
            aria-label={full ? "退出全屏" : "进入全屏"}
          >
            {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </header>
      <main className="portal-home">
        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="portal-eyebrow">
            <span /> 紫微命盘 · 塔罗问事 · AI 对话解读 <span />
          </p>
          <h1 id="portal-title">
            看懂自己，<em>看清选择。</em>
          </h1>
          <p className="portal-description">
            从出生信息展开一张命盘，或带着问题抽一组塔罗。
            <br />
            AI 结合命盘或牌面，用大白话解读，支持自由追问。
          </p>
        </section>
        <ContinueReading mode={mode} onAdmin={onAdmin} />
        <section className="portal-paths" aria-label="选择你的解读方式">
          <article
            className="portal-path portal-ziwei"
            aria-labelledby="ziwei-title"
          >
            <div className="portal-chapter">
              <span>01 / ZIWEI</span>
              <span>从出生，说起</span>
            </div>
            <div className="portal-path-heading">
              <h2 id="ziwei-title">紫微命盘</h2>
              <p>看人生的脉络</p>
            </div>
            <div className="portal-art portal-star-art" aria-hidden="true">
              <div className="portal-orbit" />
              {astrolabe}
              <span className="portal-art-label">
                十二宫 · 一张属于你的星图
              </span>
            </div>
            <p className="portal-path-description">
              了解性格与优势、事业与感情，
              <br />
              也可以聊某一年、某个阶段的变化。
            </p>
            <ol className="portal-flow" aria-label="紫微玩法">
              <li>
                <i>1</i>填出生信息
              </li>
              <li>
                <i>2</i>生成命盘
              </li>
              <li>
                <i>3</i>自由聊解读
              </li>
            </ol>
            <div className="portal-start">
              <p>
                准备好你的
                <br />
                <strong>出生年月日与时辰</strong>
              </p>
              <button onClick={onZiwei}>
                开始排盘 <ArrowUpRight size={20} />
              </button>
            </div>
          </article>
          <div className="portal-seam" aria-hidden="true">
            <span>或</span>
          </div>
          <article
            className="portal-path portal-tarot"
            aria-labelledby="tarot-title"
          >
            <div className="portal-chapter">
              <span>02 / TAROT</span>
              <span>从此刻，出发</span>
            </div>
            <div className="portal-path-heading">
              <h2 id="tarot-title">塔罗问事</h2>
              <p>聊眼前的问题</p>
            </div>
            <div className="portal-art portal-card-art" aria-hidden="true">
              <div className="portal-card-orbit" />
              <div className="portal-cards">
                <img
                  className="portal-card left"
                  src={`${import.meta.env.BASE_URL}assets/tarot/major_02.jpg`}
                  alt=""
                  width="500"
                  height="866"
                />
                <img
                  className="portal-card right"
                  src={`${import.meta.env.BASE_URL}assets/tarot/major_18.jpg`}
                  alt=""
                  width="500"
                  height="866"
                />
                <img
                  className="portal-card center"
                  src={`${import.meta.env.BASE_URL}assets/tarot/major_17.jpg`}
                  alt=""
                  width="500"
                  height="866"
                />
              </div>
              <span className="portal-art-label">
                78 张牌 · 让另一种视角浮现
              </span>
            </div>
            <p className="portal-path-description">
              带着一件在意的事、一个难做的选择，
              <br />
              或一段关系，看看接下来可以怎么走。
            </p>
            <ol className="portal-flow" aria-label="塔罗玩法">
              <li>
                <i>1</i>写下问题
              </li>
              <li>
                <i>2</i>抽牌翻牌
              </li>
              <li>
                <i>3</i>解读与追问
              </li>
            </ol>
            <div className="portal-start">
              <p>
                不用提供生日
                <br />
                <strong>带一个你在意的问题</strong>
              </p>
              <button onClick={onTarot}>
                开始抽牌 <ArrowUpRight size={20} />
              </button>
            </div>
          </article>
        </section>
        <p className="portal-common-note">
          {mode === "static"
            ? "当前为静态演示 · 紫微可在本页体验，塔罗需进入完整站点"
            : "两种玩法，一个账号 · 解读自动保存，随时接着聊"}
        </p>
        <section
          id="how-it-works"
          className="portal-guide"
          aria-labelledby="guide-title"
        >
          <div className="portal-guide-intro">
            <span className="portal-eyebrow">初次来到观星</span>
            <h2 id="guide-title">
              不用懂术语，
              <br />
              从你想问的事开始。
            </h2>
          </div>
          <div className="portal-guide-body">
            <div>
              <span>怎么选</span>
              <p>
                想了解自己和人生阶段，选<strong>紫微</strong>
                ；想聊眼前的一件事，选<strong>塔罗</strong>
                。两种方式都可以试，不需要先排命盘才能抽牌。
              </p>
            </div>
            <div>
              <span>怎么聊</span>
              <p>
                可以先看整体解读，也可以直接问“我适合怎样的工作？”或“这段关系该怎么相处？”。回复看不懂，就接着让它说具体一点。
              </p>
            </div>
            <div>
              <span>怎么继续</span>
              <p>
                {mode === "static"
                  ? "完整站点会保存你的命盘、牌面和对话。静态演示仅保留当前页面的内容。"
                  : "命盘、抽到的牌和对话都留在自己的账号里。回到同一条记录，接着聊；想重新抽牌时，再开启新的一组。"}
              </p>
            </div>
          </div>
        </section>
        <footer className="portal-footer">
          <p>
            给自己一个视角，<span>把决定留在自己手里。</span>
            <small>AI 生成 · 传统文化与牌面象征解读，供参考</small>
          </p>
          <div>
            <button onClick={onAbout}>
              关于观星 <ArrowUpRight size={13} />
            </button>
            <a
              href="https://xinglabs.github.io/"
              target="_blank"
              rel="noreferrer"
            >
              XINGLABS ↗
            </a>
            <button onClick={onAdmin}>站点管理</button>
          </div>
        </footer>
      </main>
    </>
  );
}
