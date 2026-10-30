import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  Plus,
  History,
  UserRound,
  LoaderCircle,
  Square,
  BookOpen,
  Download,
  LogOut,
  Check,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Bookmark,
  ChevronRight,
} from "lucide-react";
import { createChart, sampleInput, chartConvention } from "./lib/chart";
import type { ChartInput } from "./lib/chart";
import { readChart } from "./lib/ai";
import type { AIConfig } from "./lib/ai";
import {
  BirthForm,
  ChartBoard,
  ConnectionForm,
  Mark,
  Modal,
  PalaceDetail,
  hours,
} from "./chart-ui";
import { workspaceApi as api, WorkspaceError } from "./workspace-api";
import type {
  Health,
  Session,
  Message,
  Memory,
  AgentJob,
  AccountUsage,
  ModelProfile,
  SessionDetail,
} from "./workspace-api";
import "./reading-room.css";

export type SiteMode =
  "checking" | "public" | "local" | "static" | "unavailable";
type Panel =
  "history" | "account" | "memories" | "login" | "birth" | "connection" | null;
type Pending = {
  sessionId: string;
  content: string;
  modelId: string;
  idempotencyKey: string;
};
const blankBirth: ChartInput = {
  date: "",
  hour: 6,
  gender: "female",
  name: "",
};
const isActive = (job: AgentJob | null) =>
  Boolean(job && ["queued", "running"].includes(job.status));
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "暂时没有完成，请稍后再试。";

/** Render model text as text, never HTML. Small Markdown vocabulary keeps reports readable. */
function ReadingText({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className="reading-prose">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, index) => (
          <div key={index}>
            {block.split("\n").map((line, i) =>
              /^#{1,6}\s/.test(line) ? (
                <h3 key={i}>{inline(line.replace(/^#+\s/, ""))}</h3>
              ) : /^[-*]\s/.test(line) ? (
                <p className="reading-list-line" key={i}>
                  <span>·</span>
                  {inline(line.replace(/^[-*]\s/, ""))}
                </p>
              ) : (
                <p key={i}>{inline(line)}</p>
              ),
            )}
          </div>
        ))}
    </div>
  );
}

export default function ReadingRoom({
  initialBirth,
  demo = false,
  mode,
  onExit,
  onAdmin,
  config,
  onConfig,
}: {
  initialBirth?: ChartInput;
  demo?: boolean;
  mode: SiteMode;
  onExit: () => void;
  onAdmin: () => void;
  config: AIConfig;
  onConfig: (value: AIConfig) => void;
}) {
  const [birth, setBirth] = useState<ChartInput | null>(initialBirth || null);
  const [isDemo, setIsDemo] = useState(demo);
  const [selected, setSelected] = useState(0);
  const [palaceOpen, setPalaceOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chart" | "chat">("chart");
  const [panel, setPanel] = useState<Panel>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(mode !== "static");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [account, setAccount] = useState<AccountUsage | null>(null);
  const [job, setJob] = useState<AgentJob | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [localRunning, setLocalRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [consent, setConsent] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const alive = useRef(true);
  const epoch = useRef(0);
  const selectedId = useRef<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const sending = useRef(false);
  const restored = useRef(Boolean(initialBirth));
  const localController = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const hosted = mode === "public";
  const authenticated = Boolean(health?.authenticated);
  const currentJob = job?.sessionId === sessionId ? job : null;
  const running = isActive(job) || localRunning;
  const model = models.find((item) => item.enabled && (!hosted || item.hosted));
  const pendingMemories = memories.filter((m) => m.status === "pending");
  const chart = useMemo(() => {
    if (!birth) return null;
    try {
      return createChart(birth);
    } catch {
      return null;
    }
  }, [birth]);
  const currentPalace = chart?.palaces.find((p) => p.branch === selected);
  const valid = (version: number) => alive.current && epoch.current === version;

  function clearPrivate() {
    epoch.current++;
    setBusy(false);
    setChecking(false);
    setLoadingChart(false);
    setLocalRunning(false);
    setPollPaused(false);
    sending.current = false;
    selectedId.current = null;
    pending.current = null;
    restored.current = true;
    setSessionId(null);
    setMessages([]);
    setSessions([]);
    setMemories([]);
    setModels([]);
    setAccount(null);
    setJob(null);
    setPendingText("");
    setDraft("");
    setBirth(null);
    setIsDemo(false);
    setUncertain(false);
    setDeleteId(null);
    setPassword("");
    setConfirmation("");
    setCurrentPassword("");
    setNewPassword("");
    setPasswordAgain("");
    localController.current?.abort();
    history.replaceState(
      null,
      "",
      location.pathname + location.search + "#reading",
    );
  }
  function report(e: unknown) {
    if (e instanceof WorkspaceError && e.status === 401) {
      clearPrivate();
      setHealth((old) =>
        old ? { ...old, authenticated: false, user: null } : old,
      );
      setPanel("login");
    }
    setError(errorText(e));
  }
  function applyDetail(data: SessionDetail) {
    setMessages(data.messages);
    setBirth(data.session.birth);
    setIsDemo(false);
    const latest = data.jobs?.[0];
    if (latest && isActive(latest)) setJob(latest);
  }
  async function openSession(id: string) {
    const version = epoch.current;
    selectedId.current = id;
    setSessionId(id);
    setMessages([]);
    setBirth(null);
    setPendingText("");
    setPalaceOpen(false);
    setError("");
    setNotice("");
    setPanel(null);
    setLoadingChart(true);
    setMobileTab("chat");
    followBottom.current = true;
    history.replaceState(
      null,
      "",
      location.pathname +
        location.search +
        "#reading/" +
        encodeURIComponent(id),
    );
    try {
      const data = await api.session(id);
      if (!valid(version) || selectedId.current !== id) return;
      applyDetail(data);
      if (health?.user) {
        try {
          sessionStorage.setItem(`guanxing-reading-${health.user.id}`, id);
        } catch {
          /* Storage is optional. */
        }
      }
    } catch (e) {
      if (valid(version) && selectedId.current === id) report(e);
    } finally {
      if (valid(version) && selectedId.current === id) setLoadingChart(false);
    }
  }
  async function loadAccount(nextHealth: Health, restore = false) {
    const version = epoch.current;
    const [recordData, modelData, memoryData, accountData, jobData] =
      await Promise.all([
        api.sessions(),
        api.models(),
        api.memories(),
        hosted ? api.account() : Promise.resolve(null),
        hosted ? api.activeJobs() : Promise.resolve({ jobs: [] as AgentJob[] }),
      ]);
    if (!valid(version)) return;
    setSessions(recordData.sessions);
    setModels(modelData.models);
    setMemories(memoryData.memories);
    setAccount(accountData);
    setJob(jobData.jobs.find((j) => isActive(j)) || null);
    if (restore && !restored.current) {
      restored.current = true;
      const inHash = location.hash.match(/^#reading\/([A-Za-z0-9_-]+)$/)?.[1];
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(
          `guanxing-reading-${nextHealth.user?.id}`,
        );
      } catch {
        /* Storage is optional. */
      }
      const wanted = inHash || jobData.jobs[0]?.sessionId || saved;
      const chosen =
        recordData.sessions.find((s) => s.id === wanted) ||
        recordData.sessions[0];
      if (chosen) await openSession(chosen.id);
    }
  }
  async function refresh() {
    const version = epoch.current;
    setChecking(true);
    setError("");
    try {
      const next = await api.health();
      if (!valid(version)) return;
      setHealth(next);
      if (next.authenticated) await loadAccount(next, true);
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setChecking(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (mode !== "static" && mode !== "checking") void refresh();
    else if (mode === "static") setChecking(false);
    return () => {
      alive.current = false;
      epoch.current++;
      localController.current?.abort();
    };
  }, [mode]);
  useEffect(() => {
    if (chart) setSelected(chart.mingGongBranch);
  }, [chart]);
  useEffect(() => {
    if (followBottom.current && scrollArea.current)
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [messages, pendingText, currentJob?.status, mobileTab]);
  useEffect(() => {
    if (!hosted || !job || !isActive(job) || !authenticated) return;
    const version = epoch.current;
    let stopped = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const target = job.id;
    setPollPaused(false);
    async function poll() {
      try {
        const result = await api.job(target, controller.signal);
        if (stopped || !valid(version)) return;
        failures = 0;
        setJob(result.job);
        if (selectedId.current === result.job.sessionId) {
          const detail = await api.session(
            result.job.sessionId,
            controller.signal,
          );
          if (stopped || !valid(version)) return;
          if (selectedId.current === result.job.sessionId) {
            setMessages(detail.messages);
            if (
              detail.messages.some(
                (m) => m.role === "user" && m.createdAt >= result.job.createdAt,
              )
            )
              if (valid(version)) setPendingText("");
          }
        }
        if (isActive(result.job)) timer = setTimeout(() => void poll(), 1500);
        else {
          setPendingText("");
          if (
            result.job.status === "failed" ||
            result.job.status === "cancelled"
          )
            setNotice(result.job.error || "这次解读已停止，可以继续提问。");
          if (health) await loadAccount(health);
        }
      } catch (e) {
        if (stopped || !valid(version)) return;
        if (e instanceof WorkspaceError && e.status === 401) {
          report(e);
          return;
        }
        if (++failures >= 4) setPollPaused(true);
        else timer = setTimeout(() => void poll(), failures * 2000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.id, pollVersion, authenticated, hosted]);

  async function authenticate(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    setError("");
    if (authMode === "register" && (password !== confirmation || !consent)) {
      setError(
        password !== confirmation ? "两次密码不一致。" : "请确认资料保存说明。",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    const version = epoch.current;
    try {
      if (authMode === "register")
        await api.register(username.trim(), password);
      else await api.login(password, hosted ? username.trim() : undefined);
      if (!valid(version)) return;
      setPassword("");
      setConfirmation("");
      const next = await api.health();
      if (!valid(version)) return;
      setHealth(next);
      await loadAccount(next, true);
      if (valid(version)) {
        setPanel(null);
        setNotice(
          draft
            ? "已经登录，可以发送刚才的问题。"
            : "欢迎回来。你的解读会保存在这里。",
        );
      }
    } catch (e) {
      if (valid(version)) setError(errorText(e));
    } finally {
      if (valid(version)) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  async function send(retry = false) {
    if (sending.current || running || loadingChart) return;
    const content = retry ? pending.current?.content : draft.trim();
    if (!content) return;
    if (!birth) {
      setPanel("birth");
      return;
    }
    if (mode === "checking" || mode === "unavailable") {
      setError("暂时无法连接服务，请稍后重试。");
      return;
    }
    if (mode !== "static" && !authenticated) {
      setAuthMode("login");
      setPanel("login");
      return;
    }
    if ((mode === "static" || mode === "local") && !config.apiKey) {
      setPanel("connection");
      return;
    }
    if (mode !== "static" && !model) {
      setError("解读服务暂未开放，请稍后再来。");
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setMobileTab("chat");
    followBottom.current = true;
    const version = epoch.current;
    try {
      if (mode === "static") {
        const current = new AbortController();
        localController.current = current;
        setLocalRunning(true);
        const previous = messages;
        setPendingText(content);
        setDraft("");
        const reply = await readChart(
          createChart(birth),
          config,
          content,
          current.signal,
          previous,
        );
        if (!valid(version)) return;
        setMessages([
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
            createdAt: new Date().toISOString(),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        let id = retry ? pending.current?.sessionId : sessionId;
        if (!id) {
          const result = await api.createSession({
            title: `${birth.name || "我的星图"} · ${birth.date}`,
            birth,
          });
          if (!valid(version)) return;
          id = result.session.id;
          selectedId.current = id;
          setSessionId(id);
          setSessions((old) => [result.session, ...old]);
          history.replaceState(
            null,
            "",
            location.pathname +
              location.search +
              "#reading/" +
              encodeURIComponent(id),
          );
          try {
            sessionStorage.setItem(`guanxing-reading-${health?.user?.id}`, id);
          } catch {
            /* Optional. */
          }
        }
        if (hosted) {
          const payload =
            retry && pending.current
              ? pending.current
              : {
                  sessionId: id,
                  modelId: model!.id,
                  content,
                  idempotencyKey: crypto.randomUUID(),
                };
          pending.current = payload;
          const result = await api.enqueue(id, payload);
          if (!valid(version)) return;
          pending.current = null;
          setUncertain(false);
          setDraft("");
          setPendingText(content);
          setJob(result.job);
          if (!isActive(result.job)) {
            const detail = await api.session(id);
            if (valid(version) && selectedId.current === id)
              setMessages(detail.messages);
            if (health) await loadAccount(health);
            if (valid(version)) setPendingText("");
          }
        } else {
          const current = new AbortController();
          localController.current = current;
          setLocalRunning(true);
          setPendingText(content);
          setDraft("");
          await api.run(
            id,
            { content, modelId: model!.id, apiKey: config.apiKey },
            current.signal,
          );
          if (!valid(version)) return;
          const detail = await api.session(id);
          if (valid(version) && selectedId.current === id)
            setMessages(detail.messages);
          if (health) await loadAccount(health);
        }
      }
    } catch (e) {
      if (valid(version)) {
        if (
          hosted &&
          pending.current &&
          (!(e instanceof WorkspaceError) || e.status === 0 || e.status >= 500)
        )
          setUncertain(true);
        else pending.current = null;
        report(e);
        if (!hosted) setDraft(content);
      }
    } finally {
      if (valid(version)) {
        sending.current = false;
        setBusy(false);
        setLocalRunning(false);
        if (!hosted) setPendingText("");
      }
    }
  }
  async function stop() {
    if (!hosted) {
      localController.current?.abort();
      return;
    }
    if (!job) return;
    const version = epoch.current;
    setBusy(true);
    try {
      await api.cancelJob(job.id);
      if (valid(version)) {
        setNotice("已请求停止，正在确认结果。");
        setPollVersion((v) => v + 1);
      }
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setBusy(false);
    }
  }
  function newChart(value: ChartInput) {
    selectedId.current = null;
    restored.current = true;
    setSessionId(null);
    setBirth(value);
    setLoadingChart(false);
    setIsDemo(false);
    setMessages([]);
    setDraft("");
    setPendingText("");
    setPanel(null);
    setError("");
    setNotice("");
    setPalaceOpen(false);
    setMobileTab("chart");
    history.replaceState(
      null,
      "",
      location.pathname + location.search + "#reading",
    );
  }
  async function logout() {
    const version = epoch.current;
    setBusy(true);
    try {
      await api.logout();
      if (!valid(version)) return;
      clearPrivate();
      setHealth((old) =>
        old ? { ...old, authenticated: false, user: null } : old,
      );
      setPanel(null);
      setError("");
      setNotice("已退出登录。");
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== passwordAgain) {
      setError("两次新密码不一致。");
      return;
    }
    const version = epoch.current;
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      if (valid(version)) {
        setCurrentPassword("");
        setNewPassword("");
        setPasswordAgain("");
        setNotice("密码已更新，其他设备上的旧登录已退出。");
      }
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setBusy(false);
    }
  }
  async function updateMemory(id: string, action: "confirm" | "delete") {
    const version = epoch.current;
    setBusy(true);
    setError("");
    try {
      if (action === "delete") await api.deleteMemory(id);
      else await api.updateMemory(id, { status: "active" });
      const data = await api.memories();
      if (valid(version)) {
        setMemories(data.memories);
        setDeleteId(null);
      }
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setBusy(false);
    }
  }
  async function removeSession(id: string) {
    const version = epoch.current;
    setBusy(true);
    setError("");
    try {
      await api.deleteSession(id);
      if (!valid(version)) return;
      setSessions((old) => old.filter((s) => s.id !== id));
      setDeleteId(null);
      if (selectedId.current === id) {
        selectedId.current = null;
        setSessionId(null);
        setBirth(null);
        setMessages([]);
        setPendingText("");
        history.replaceState(
          null,
          "",
          location.pathname + location.search + "#reading",
        );
      }
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setBusy(false);
    }
  }
  async function exportData() {
    const version = epoch.current;
    setBusy(true);
    try {
      const data = await api.exportData();
      if (!valid(version)) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "观星-我的记录.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (valid(version)) report(e);
    } finally {
      if (valid(version)) setBusy(false);
    }
  }
  function downloadReading() {
    const text = `${birth?.name || "观星"}\n${birth?.date || ""} ${birth ? hours[birth.hour] : ""}\n${chartConvention}\n\n${messages.map((m) => `${m.role === "user" ? "我" : "观星"}\n${m.content}`).join("\n\n")}\n\nAI 生成，传统文化解读。`;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `观星-${birth?.date || "解读"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openPersonal(target: "account" | "history" | "memories") {
    setError("");
    setNotice("");
    setDeleteId(null);
    if (mode === "static") {
      setNotice("演示页的对话只保留在本次页面，可用右上角下载保存。");
      return;
    }
    if (!authenticated) {
      setAuthMode("login");
      setPanel("login");
    } else setPanel(target);
  }
  const quota = account
    ? Math.max(0, account.dailyRunLimit - account.usedToday)
    : null;
  const sessionTitle = birth
    ? isDemo || birth.name === sampleInput.name
      ? "示例星图"
      : birth.name
        ? `${birth.name}的星图`
        : "我的星图"
    : "一张属于你的星图";
  const composerDisabled =
    busy || loadingChart || uncertain || mode === "checking";

  return (
    <div className="reader-shell">
      <header className="reader-header">
        <button
          className="reader-brand"
          onClick={onExit}
          aria-label="返回观星封面"
        >
          <Mark small />
          <span>
            观星<small>GUANXING</small>
          </span>
        </button>
        <span className="reader-header-note">一张星图，一段慢慢展开的对话</span>
        <div className="reader-header-actions">
          <button
            aria-label="新的星图"
            disabled={busy || uncertain || localRunning || loadingChart}
            onClick={() => setPanel("birth")}
          >
            <Plus size={16} />
            <span>新的星图</span>
          </button>
          <button onClick={() => openPersonal("history")} aria-label="我的解读">
            <History size={17} />
            <span>我的解读</span>
          </button>
          {mode !== "static" && (
            <button
              onClick={() => openPersonal("account")}
              aria-label={authenticated ? "我的账号" : "登录"}
            >
              <UserRound size={17} />
              <span>
                {authenticated ? health?.user?.username || "我的" : "登录"}
              </span>
            </button>
          )}
        </div>
      </header>
      <nav className="reader-mobile-tabs" aria-label="命盘与对话">
        <button
          aria-pressed={mobileTab === "chart"}
          onClick={() => setMobileTab("chart")}
        >
          我的命盘
        </button>
        <button
          aria-pressed={mobileTab === "chat"}
          onClick={() => setMobileTab("chat")}
        >
          对话解读 {isActive(currentJob) && <i />}
        </button>
      </nav>
      <main className={`reader-layout show-${mobileTab}`}>
        <section className="reader-chart-side" aria-label="命盘">
          <div className="reader-chart-heading">
            <div>
              <h1>{sessionTitle}</h1>
              <p>
                {birth
                  ? `${birth.date.replaceAll("-", " / ")} · ${hours[birth.hour].split(" · ")[0]} · ${birth.gender === "female" ? "女" : "男"}`
                  : "记下出生的日期与时辰，展开十二宫。"}
              </p>
            </div>
            {birth && (
              <button
                className="reader-subtle"
                disabled={busy || uncertain || localRunning || loadingChart}
                onClick={() => setPanel("birth")}
              >
                重新排盘 <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          {loadingChart ? (
            <div className="reader-chart-empty">
              <LoaderCircle className="spin" />
              <p>正在展开这张星图…</p>
            </div>
          ) : chart ? (
            <>
              <ChartBoard
                chart={chart}
                selected={selected}
                onSelect={(branch) => {
                  setSelected(branch);
                  setPalaceOpen(true);
                }}
              />
              {palaceOpen && currentPalace ? (
                <PalaceDetail
                  palace={currentPalace}
                  onDiscuss={() => {
                    setDraft(
                      `帮我讲讲${currentPalace.name}${currentPalace.name.endsWith("宫") ? "" : "宫"}。`,
                    );
                    setMobileTab("chat");
                    composer.current?.focus();
                  }}
                />
              ) : (
                <div className="reader-chart-caption">
                  <span>
                    命主 {chart.mingZhu} · 身主 {chart.shenZhu}
                  </span>
                  <span>{chart.wuxingJuName} · 点选宫位查看星曜</span>
                </div>
              )}
            </>
          ) : (
            <div className="reader-chart-empty">
              <div className="reader-empty-orbit">
                <Mark />
              </div>
              <h2>从出生的那一刻开始。</h2>
              <p>
                先排出命盘，再聊你此刻关心的事。
                <br />
                看盘不需要登录。
              </p>
              <button className="primary" onClick={() => setPanel("birth")}>
                填写出生信息 <ArrowUpRight size={18} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  newChart(sampleInput);
                  setIsDemo(true);
                }}
              >
                先看一张示例
              </button>
            </div>
          )}
          <details className="reader-convention">
            <summary>排盘口径与说明</summary>
            <p>{chartConvention}</p>
            <p>
              出生资料在浏览器中排盘。
              {hosted
                ? "发送问题后，当前命盘与对话会保存到你的账号，并交给本站配置的 AI 解读。"
                : "主动解读时，问题、相关对话与命盘星曜会交给你配置的 AI 服务。"}
            </p>
          </details>
        </section>
        <section className="reader-conversation" aria-label="命盘对话">
          <header className="reader-conversation-heading">
            <div>
              <h2>
                与星图对话<span>AI 解读</span>
              </h2>
            </div>
            <button
              className="reader-ink-icon"
              aria-label="下载这段解读"
              title="下载这段解读"
              disabled={!messages.length}
              onClick={downloadReading}
            >
              <Download size={18} />
            </button>
          </header>
          <div
            className="reader-transcript"
            ref={scrollArea}
            onScroll={() => {
              const el = scrollArea.current;
              if (el)
                followBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            }}
          >
            {!messages.length && !pendingText ? (
              <div className="reader-welcome">
                <div className="reader-conversation-star">
                  <Mark />
                </div>
                <h3>
                  从你在意的事，
                  <br />
                  慢慢聊起。
                </h3>
                <p>
                  可以看整张命盘，也可以只聊一个问题。
                  <br />
                  不用懂星曜，不用选题目，想到什么就问什么。
                </p>
                <div className="reader-starters">
                  {[
                    "先帮我看看这张命盘",
                    "我更适合怎样的工作？",
                    "聊聊我的感情和相处方式",
                  ].map((q) => (
                    <button
                      key={q}
                      disabled={busy || uncertain}
                      onClick={() => {
                        setDraft(q);
                        composer.current?.focus();
                      }}
                    >
                      {q}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`reader-message ${message.role}`}
                  key={message.id}
                >
                  <div className="reader-message-byline">
                    {message.role === "user" ? (
                      "我"
                    ) : (
                      <>
                        <Mark small />
                        观星
                      </>
                    )}
                  </div>
                  <ReadingText text={message.content} />
                </article>
              ))
            )}
            {pendingText && (
              <article className="reader-message user">
                <div className="reader-message-byline">我</div>
                <ReadingText text={pendingText} />
              </article>
            )}
            {(isActive(currentJob) || localRunning) && (
              <div className="reader-thinking" role="status">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                {currentJob?.status === "queued"
                  ? "正在等候解读，稍后会继续…"
                  : "正在读你的星图…"}
                <small>
                  {hosted
                    ? "离开页面也会继续，稍后可在「我的解读」查看。"
                    : "回复会显示在这里。"}
                </small>
              </div>
            )}
            {pendingMemories.length > 0 && (
              <button
                className="reader-memory-note"
                onClick={() => openPersonal("memories")}
              >
                <Bookmark size={15} />
                {pendingMemories.length} 件你提到的事，等你确认后再记住{" "}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
          <div className="reader-compose-area">
            {error && (
              <p className="reader-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="reader-notice" role="status">
                {notice}
              </p>
            )}
            {uncertain && (
              <div className="reader-reconnect">
                <p>
                  还没确认刚才的问题是否送达。重试会沿用同一次提交，不重复扣次。
                </p>
                <button disabled={busy} onClick={() => void send(true)}>
                  <RefreshCw size={14} />
                  确认刚才的提交
                </button>
              </div>
            )}
            {pollPaused && (
              <div className="reader-reconnect">
                <p>暂时收不到进度，解读仍会继续。</p>
                <button onClick={() => setPollVersion((v) => v + 1)}>
                  <RefreshCw size={14} />
                  重新连接
                </button>
              </div>
            )}
            {isActive(job) && job?.sessionId !== sessionId && (
              <button
                className="reader-other-job"
                onClick={() => void openSession(job!.sessionId)}
              >
                你另一张星图的解读还在继续，去看看 <ArrowUpRight size={14} />
              </button>
            )}
            {(mode === "static" || mode === "local") && (
              <button
                className="reader-connection-link"
                onClick={() => setPanel("connection")}
              >
                {config.apiKey
                  ? "连接设置 · 修改 API Key"
                  : "连接设置 · 填写 API Key"}
              </button>
            )}
            <form
              className="reader-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="reading-question">
                想聊的问题
              </label>
              <textarea
                ref={composer}
                id="reading-question"
                rows={2}
                maxLength={6000}
                placeholder={
                  messages.length
                    ? "继续问，或者聊聊刚才的某一点…"
                    : "比如：从这张命盘看，我做事最大的优势是什么？"
                }
                value={draft}
                disabled={composerDisabled}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    !matchMedia("(pointer: coarse)").matches
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="reader-composer-bottom">
                <span>
                  {checking
                    ? "正在连接…"
                    : quota !== null
                      ? `今日还可提问 ${quota} 次`
                      : hosted
                        ? "登录后保存你的解读"
                        : "本次页面内连续对话"}
                </span>
                {isActive(currentJob) || localRunning ? (
                  <button
                    type="button"
                    className="reader-stop"
                    disabled={busy}
                    onClick={() => void stop()}
                  >
                    <Square size={13} />
                    停止
                  </button>
                ) : (
                  <button
                    className="reader-send"
                    aria-label="发送问题"
                    disabled={
                      composerDisabled ||
                      running ||
                      !draft.trim() ||
                      quota === 0
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                )}
              </div>
            </form>
            <p className="reader-footnote">AI 生成 · 传统文化解读，供参考</p>
          </div>
        </section>
      </main>
      {panel === "birth" && (
        <BirthForm
          initial={birth || blankBirth}
          onCreate={newChart}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "connection" && (
        <ConnectionForm
          config={
            mode === "local" && model
              ? { ...config, baseUrl: model.baseUrl, model: model.model }
              : config
          }
          keyOnly={mode === "local"}
          onSave={onConfig}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "login" && (
        <Modal
          title={authMode === "login" ? "登录观星" : "创建账号"}
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          <div className="reader-modal-heading">
            <span className="chapter">KEEP YOUR STORY</span>
            <h2>
              {authMode === "login"
                ? "把这段对话，留下来。"
                : "留一处自己的星空。"}
            </h2>
            <p>
              {health?.needsSetup
                ? "站点正在准备中，请稍后再来。"
                : "登录后，命盘、解读和你确认过的事都能继续查看。"}
            </p>
          </div>
          {health?.needsSetup ? (
            <button className="text-button" onClick={onAdmin}>
              站点管理员初始化 <ArrowUpRight size={15} />
            </button>
          ) : (
            <form className="birth-form" onSubmit={authenticate}>
              {hosted && (
                <label>
                  用户名
                  <input
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}"
                    autoComplete="username"
                    placeholder="3–32 位字母、数字或下划线"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
              )}
              <label>
                密码
                <input
                  type="password"
                  required
                  minLength={authMode === "register" ? 12 : 1}
                  maxLength={256}
                  autoComplete={
                    authMode === "register"
                      ? "new-password"
                      : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {authMode === "register" && (
                <>
                  <label>
                    再次输入密码
                    <input
                      type="password"
                      required
                      minLength={12}
                      maxLength={256}
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                    />
                  </label>
                  <label className="reader-consent">
                    <input
                      type="checkbox"
                      required
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>
                      我了解发送的出生资料与对话会保存到本站，可自行导出和删除；相关内容会交给
                      AI 服务解读。
                    </span>
                  </label>
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "请稍候…"
                  : authMode === "login"
                    ? "登录，继续聊"
                    : "创建账号"}
                <ArrowUpRight size={17} />
              </button>
              {hosted &&
                (authMode === "register" || health?.registrationOpen) && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setAuthMode(authMode === "login" ? "register" : "login");
                      setPassword("");
                      setConfirmation("");
                      setError("");
                    }}
                  >
                    {authMode === "login"
                      ? "第一次来，创建账号"
                      : "已有账号，去登录"}
                  </button>
                )}
              {hosted && !health?.registrationOpen && (
                <p className="privacy-line">本站暂未开放新用户注册。</p>
              )}
              <p className="privacy-line">忘记密码时，可联系站点管理员重置。</p>
            </form>
          )}
        </Modal>
      )}
      {panel === "history" && (
        <Modal
          title="我的解读"
          onClose={() => {
            if (!busy) setPanel(null);
          }}
          wide
        >
          <div className="reader-modal-heading">
            <span className="chapter">YOUR CONSTELLATIONS</span>
            <h2>每次回来，接着聊。</h2>
            <p>打开一张旧星图，命盘和对话会一起回到你面前。</p>
          </div>
          <div className="reader-history-list">
            {sessions.length ? (
              sessions.map((session) => (
                <div key={session.id}>
                  <button
                    className="reader-history-open"
                    disabled={busy || uncertain}
                    onClick={() => void openSession(session.id)}
                  >
                    <BookOpen size={20} />
                    <span>
                      <strong>{session.title}</strong>
                      <small>
                        {session.birth
                          ? `${session.birth.date} · ${hours[session.birth.hour].split(" · ")[0]}`
                          : "未附命盘"}{" "}
                        ·{" "}
                        {new Date(session.updatedAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </small>
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                  {deleteId === session.id ? (
                    <div className="reader-delete-confirm">
                      <span>
                        删除这段解读与附带命盘？当天已用次数不会恢复。
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => void removeSession(session.id)}
                      >
                        确认删除
                      </button>
                      <button onClick={() => setDeleteId(null)}>保留</button>
                    </div>
                  ) : (
                    <button
                      className="reader-subtle"
                      disabled={
                        busy || (isActive(job) && job?.sessionId === session.id)
                      }
                      aria-label={`删除 ${session.title}`}
                      onClick={() => setDeleteId(session.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="reader-empty-copy">
                还没有保存的解读。排出命盘并发送第一个问题，就会留在这里。
              </p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {panel === "account" && (
        <Modal
          title="我的账号"
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          <div className="reader-modal-heading">
            <span className="chapter">A PLACE OF YOUR OWN</span>
            <h2>{health?.user?.username || "旅人"}，欢迎回来。</h2>
            <p>
              {quota !== null
                ? `今天还可以提问 ${quota} 次。`
                : "你的命盘与解读，都留在这里。"}
            </p>
          </div>
          <div className="reader-account-links">
            <button onClick={() => setPanel("memories")}>
              <Bookmark size={17} />
              记住的事{" "}
              <span>
                {memories.length}
                <ChevronRight size={15} />
              </span>
            </button>
            <button disabled={busy} onClick={() => void exportData()}>
              <Download size={17} />
              导出我的记录
              <ArrowUpRight size={15} />
            </button>
            {(health?.user?.role === "admin" || mode === "local") && (
              <button onClick={onAdmin}>
                <ShieldCheck size={17} />
                进入管理后台
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          {hosted && (
            <details className="reader-password">
              <summary>修改登录密码</summary>
              <form className="birth-form" onSubmit={changePassword}>
                <label>
                  当前密码
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </label>
                <label>
                  新密码
                  <input
                    type="password"
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label>
                  再次输入新密码
                  <input
                    type="password"
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                    value={passwordAgain}
                    onChange={(e) => setPasswordAgain(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  保存新密码
                </button>
              </form>
            </details>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="privacy-line" role="status">
              {notice}
            </p>
          )}
          <button
            className="text-button reader-logout"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={16} />
            退出登录
          </button>
        </Modal>
      )}
      {panel === "memories" && (
        <Modal
          title="记住的事"
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          <div className="reader-modal-heading">
            <span className="chapter">ONLY WHAT YOU CHOOSE</span>
            <h2>愿意留下的，再记住。</h2>
            <p>
              你在聊天里提到、希望长期记住的事，经你确认后才会用于之后的解读。随时可以删掉。
            </p>
          </div>
          <div className="reader-memory-list">
            {memories.length ? (
              memories.map((memory) => (
                <article key={memory.id}>
                  <span>
                    {memory.status === "pending" ? "等你确认" : "已经记住"} ·{" "}
                    {memory.sessionId ? "这段对话" : "之后的对话也记得"}
                  </span>
                  <p>{memory.content}</p>
                  <div>
                    {memory.status === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() => void updateMemory(memory.id, "confirm")}
                      >
                        <Check size={15} />
                        记住这件事
                      </button>
                    )}
                    {deleteId === memory.id ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => void updateMemory(memory.id, "delete")}
                        >
                          确认移除
                        </button>
                        <button onClick={() => setDeleteId(null)}>保留</button>
                      </>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => setDeleteId(memory.id)}
                      >
                        <Trash2 size={15} />
                        移除
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p className="reader-empty-copy">
                还没有需要记住的事。可以在聊天里说“请记住……”。
              </p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
