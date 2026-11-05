import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  History,
  LoaderCircle,
  LogOut,
  Plus,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { Mark, Modal } from "./chart-ui";
import ReadingText from "./ReadingText";
import ReadingReply from "./ReadingReply";
import { appendConversationDraft } from "./lib/conversation";
import {
  workspaceApi as api,
  WorkspaceError,
  type Health,
  type Session,
  type Message,
  type AgentJob,
  type SessionDetail,
  type Memory,
} from "./workspace-api";
import { tarotDeck, tarotSpreads, type TarotSpreadId } from "./lib/tarot";
import type { SiteMode } from "./ReadingRoom";
import "./reading-room.css";
import "./tarot-room.css";

const active = (j: AgentJob | null) =>
  !!j && ["queued", "running"].includes(j.status);
function CardBack() {
  return (
    <div className="tarot-card-back" aria-hidden="true">
      <div className="tarot-back-border" />
      <svg viewBox="0 0 120 196">
        <ellipse cx="60" cy="98" rx="31" ry="53" />
        <ellipse cx="60" cy="98" rx="31" ry="53" transform="rotate(60 60 98)" />
        <ellipse
          cx="60"
          cy="98"
          rx="31"
          ry="53"
          transform="rotate(-60 60 98)"
        />
        <circle cx="60" cy="98" r="24" />
        <path d="M60 60 70 88 98 98 70 108 60 136 50 108 22 98 50 88Z" />
        <path d="M60 22v12M54 28h12M60 162v12M54 168h12" />
      </svg>
      <span>观 星</span>
    </div>
  );
}
export default function TarotRoom({
  mode,
  onExit,
  onAdmin,
}: {
  mode: SiteMode;
  onExit: () => void;
  onAdmin: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null),
    [records, setRecords] = useState<Session[]>([]),
    [messages, setMessages] = useState<Message[]>([]),
    [job, setJob] = useState<AgentJob | null>(null);
  const [question, setQuestion] = useState(""),
    [spreadId, setSpreadId] = useState<TarotSpreadId>("three"),
    [reversed, setReversed] = useState(true),
    [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<number[]>([]),
    [page, setPage] = useState(0),
    [shuffling, setShuffling] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [detail, setDetail] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [again, setAgain] = useState(""),
    [consent, setConsent] = useState(false);
  const [flights, setFlights] = useState<{ x: number; y: number }[]>([]),
    [pollTick, setPollTick] = useState(0),
    [pollError, setPollError] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true),
    epoch = useRef(0),
    lock = useRef(false),
    selectedRef = useRef<number[]>([]),
    slots = useRef<(HTMLButtonElement | null)[]>([]),
    currentId = useRef<string | null>(null),
    scrollEnd = useRef<HTMLDivElement>(null);
  const pending = useRef<{
      sessionId: string;
      content: string;
      idempotencyKey: string;
    } | null>(null),
    creation = useRef<{
      requestId: string;
      question: string;
      spreadId: TarotSpreadId;
      reversedAllowed: boolean;
    } | null>(null);
  const reading = session?.tarot,
    spread = tarotSpreads.find(
      (s) => s.id === (reading?.spreadId || spreadId),
    )!,
    revealed = reading?.status === "revealed",
    running = active(job),
    signedIn = !!health?.authenticated;
  const valid = (v: number) => alive.current && epoch.current === v;
  function continueWith(question: string) {
    if (busy || running || pending.current) return;
    const next = appendConversationDraft(draft, question);
    if (next === null) {
      setError("输入框里还有较长的内容，请先发送或删减后再添加追问。");
      return;
    }
    setDraft(next);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }
  function address(id?: string) {
    history.replaceState(
      null,
      "",
      location.pathname + location.search + "#tarot" + (id ? "/" + id : ""),
    );
  }
  function reset() {
    epoch.current++;
    currentId.current = null;
    setSession(null);
    setMessages([]);
    setJob(null);
    setSelected([]);
    selectedRef.current = [];
    setFlights([]);
    setPage(0);
    setDraft("");
    setDetail(null);
    setError("");
    pending.current = null;
    creation.current = null;
    setHistoryOpen(false);
    setMemoryOpen(false);
    address();
    try {
      if (health?.user)
        sessionStorage.removeItem("guanxing-tarot-" + health.user.id);
    } catch {
      /* Storage is optional. */
    }
  }
  function report(e: unknown) {
    if (e instanceof WorkspaceError && e.status === 401) {
      reset();
      setRecords([]);
      setMemories([]);
      setHealth((h) => (h ? { ...h, authenticated: false, user: null } : h));
    }
    setError(e instanceof Error ? e.message : "暂时没有完成，请重试。");
  }
  function apply(data: SessionDetail) {
    if (!data.session.tarot)
      throw Error("这是一张紫微命盘，请到「紫微命盘」查看。");
    currentId.current = data.session.id;
    setSession(data.session);
    setMessages(data.messages);
    setSelected(data.session.tarot.selection);
    selectedRef.current = data.session.tarot.selection;
    setQuestion(data.session.tarot.question);
    setSpreadId(data.session.tarot.spreadId);
    setReversed(data.session.tarot.reversedAllowed);
    setJob(data.jobs?.find((j) => active(j)) || null);
    address(data.session.id);
  }
  async function openRecord(id: string) {
    if (lock.current || running) return;
    const v = ++epoch.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setHistoryOpen(false);
    try {
      const d = await api.session(id);
      if (valid(v)) apply(d);
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadAccount(h: Health) {
    if (h.user?.role === "admin") {
      onAdmin();
      return;
    }
    const v = epoch.current;
    const list = (await api.sessions()).sessions.filter((s) => s.tarot);
    if (!valid(v)) return;
    setRecords(list);
    const savedMemories = await api.memories();
    if (!valid(v)) return;
    setMemories(savedMemories.memories);
    const hash = location.hash.match(/^#tarot\/([a-f0-9-]+)$/i)?.[1];
    if (hash) {
      const d = await api.session(hash);
      if (valid(v)) apply(d);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (mode === "checking") return;
    if (mode !== "public") {
      setLoading(false);
      return;
    }
    const v = epoch.current;
    void api
      .health()
      .then(async (h) => {
        if (!valid(v)) return;
        setHealth(h);
        if (h.authenticated) await loadAccount(h);
      })
      .catch((e) => {
        if (valid(v)) report(e);
      })
      .finally(() => {
        if (valid(v)) setLoading(false);
      });
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, [mode]);
  useEffect(() => {
    if (health?.user && session)
      try {
        sessionStorage.setItem("guanxing-tarot-" + health.user.id, session.id);
      } catch {
        /* Optional. */
      }
  }, [session?.id, health?.user?.id]);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length]);
  useEffect(() => {
    if (!job || !active(job) || !signedIn) return;
    const v = epoch.current,
      id = job.id;
    let timer: ReturnType<typeof setTimeout>,
      stopped = false,
      failures = 0;
    const c = new AbortController();
    setPollError(false);
    async function poll() {
      try {
        const r = await api.job(id, c.signal);
        if (stopped || !valid(v)) return;
        setJob(r.job);
        failures = 0;
        if (currentId.current === r.job.sessionId) {
          const d = await api.session(r.job.sessionId, c.signal);
          if (stopped || !valid(v)) return;
          setMessages(d.messages);
        }
        if (!active(r.job)) {
          const savedMemories = await api.memories();
          if (stopped || !valid(v)) return;
          setMemories(savedMemories.memories);
        }
        if (active(r.job)) timer = setTimeout(() => void poll(), 1500);
        else if (r.job.status !== "completed")
          setError(r.job.error || "这次解读未完成，可以继续提问。");
      } catch (e) {
        if (stopped || !valid(v)) return;
        if (e instanceof WorkspaceError && e.status === 401) {
          report(e);
          return;
        }
        if (++failures >= 4) setPollError(true);
        else timer = setTimeout(() => void poll(), failures * 1500);
      }
    }
    void poll();
    return () => {
      stopped = true;
      c.abort();
      clearTimeout(timer);
    };
  }, [job?.id, pollTick, signedIn]);
  async function authenticate(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (authMode === "register" && (password !== again || !consent)) {
      setError("请确认两次密码一致，并勾选资料保存说明。");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const v = epoch.current;
    try {
      if (authMode === "register")
        await api.register(username.trim(), password);
      else await api.login(password, username.trim());
      if (!valid(v)) return;
      setPassword("");
      setAgain("");
      const h = await api.health();
      if (!valid(v)) return;
      setHealth(h);
      await loadAccount(h);
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function begin(e: FormEvent) {
    e.preventDefault();
    if (lock.current || running) return;
    lock.current = true;
    setBusy(true);
    setShuffling(true);
    setError("");
    const v = epoch.current;
    const payload = creation.current || {
      requestId: crypto.randomUUID(),
      question: question.trim(),
      spreadId,
      reversedAllowed: reversed,
    };
    creation.current = payload;
    try {
      const [r] = await Promise.all([
        api.createTarot(payload),
        new Promise((r) => setTimeout(r, 1000)),
      ]);
      if (!valid(v)) return;
      creation.current = null;
      setSession(r.session);
      currentId.current = r.session.id;
      setSelected([]);
      selectedRef.current = [];
      setFlights([]);
      setRecords((prev) => [
        r.session,
        ...prev.filter((s) => s.id !== r.session.id),
      ]);
      address(r.session.id);
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setShuffling(false);
      }
    }
  }
  function pick(index: number, button: HTMLButtonElement) {
    if (
      busy ||
      revealed ||
      selectedRef.current.includes(index) ||
      selectedRef.current.length >= spread.positions.length
    )
      return;
    const slot =
        slots.current[selectedRef.current.length]?.getBoundingClientRect(),
      from = button.getBoundingClientRect();
    setFlights((f) => [
      ...f,
      {
        x: slot ? from.x + from.width / 2 - slot.x - slot.width / 2 : 0,
        y: slot ? from.y + from.height / 2 - slot.y - slot.height / 2 : 200,
      },
    ]);
    selectedRef.current = [...selectedRef.current, index];
    setSelected(selectedRef.current);
  }
  async function reveal() {
    if (lock.current || !session) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const v = epoch.current;
    try {
      const r = await api.revealTarot(session.id, selectedRef.current);
      if (valid(v)) {
        setSession(r.session);
        setRecords((old) =>
          old.map((s) => (s.id === r.session.id ? r.session : s)),
        );
      }
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function send(content: string) {
    if (!content.trim() || lock.current || running || !session || !revealed)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const v = epoch.current;
    const payload = pending.current || {
      sessionId: session.id,
      content: content.trim(),
      idempotencyKey: crypto.randomUUID(),
    };
    pending.current = payload;
    try {
      const r = await api.enqueue(payload.sessionId, payload);
      if (!valid(v)) return;
      pending.current = null;
      setDraft("");
      setJob(r.job);
      const d = await api.session(session.id);
      if (valid(v)) setMessages(d.messages);
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function changeMemory(id: string, remove = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const v = epoch.current;
    try {
      if (remove) await api.deleteMemory(id);
      else await api.updateMemory(id, { status: "active" });
      const saved = await api.memories();
      if (valid(v)) setMemories(saved.memories);
    } catch (e) {
      if (valid(v)) report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function logout() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await api.logout();
      reset();
      setRecords([]);
      setMemories([]);
      setHealth((h) => (h ? { ...h, authenticated: false, user: null } : h));
    } catch (e) {
      report(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const face = detail !== null ? reading?.cards[detail] : undefined,
    faceCard = tarotDeck.find((c) => c.id === face?.cardId);
  return (
    <div className="reader-shell tarot-shell">
      <header className="reader-header tarot-header">
        <button
          className="reader-brand brand"
          onClick={onExit}
          aria-label="观星首页"
        >
          <Mark />
          <span>
            观星<small>GUANXING</small>
          </span>
        </button>
        <span className="tarot-header-caption">星光之下，把问题轻轻放下。</span>
        <nav aria-label="塔罗导航">
          <a href="#reading">紫微命盘</a>
          <button
            aria-label="新的一组"
            disabled={busy || running}
            onClick={() => {
              reset();
              setQuestion("");
            }}
          >
            <Plus size={16} />
            <span>新的一组</span>
          </button>
          <button
            aria-label="我的塔罗"
            disabled={busy || running}
            onClick={() => setHistoryOpen(true)}
          >
            <History size={16} />
            <span>我的塔罗</span>
          </button>
          {signedIn && (
            <button
              disabled={busy || running}
              onClick={() => void logout()}
              aria-label="退出登录"
            >
              <LogOut size={16} />
            </button>
          )}
        </nav>
      </header>
      {loading || mode === "checking" ? (
        <div className="reader-entry-stage">
          <LoaderCircle className="spin" />
          正在铺开牌桌…
        </div>
      ) : mode !== "public" ? (
        <main className="reader-entry-stage">
          <Mark />
          <h1>一组牌，一段新的对话。</h1>
          <p>塔罗问事在完整网站开放，共用观星账号与解读服务。</p>
          <a className="primary" href="https://guanxing.online/#tarot">
            前往塔罗牌桌 <ArrowUpRight size={18} />
          </a>
        </main>
      ) : !signedIn ? (
        <main className="tarot-auth">
          <div className="tarot-auth-art">
            <div className="tarot-still-card">
              <CardBack />
            </div>
            <span>THE ANSWER WITHIN</span>
            <h1>
              让心里的问题，
              <br />
              有一个展开的地方。
            </h1>
            <p>不需要出生信息。选一组牌，从你在意的事聊起。</p>
          </div>
          <form className="tarot-auth-form" onSubmit={authenticate}>
            <span className="chapter">观星 / 塔罗</span>
            <h2>{authMode === "login" ? "登录，入席。" : "留下你的名字。"}</h2>
            <label>
              账号
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                type="password"
                required
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
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </label>
                <label className="tarot-check">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  我知道问题、牌面与对话会保存到账号，解读时发送给网站配置的
                  AI。
                </label>
              </>
            )}
            {error && (
              <p className="tarot-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : authMode === "login" ? (
                "进入牌桌"
              ) : (
                "注册并进入"
              )}
              <ArrowUpRight size={17} />
            </button>
            {health?.registrationOpen && (
              <button
                type="button"
                className="tarot-text-button"
                onClick={() => {
                  setAuthMode((a) => (a === "login" ? "register" : "login"));
                  setError("");
                }}
              >
                {authMode === "login" ? "还没有账号？注册" : "已有账号，去登录"}
              </button>
            )}
          </form>
        </main>
      ) : (
        <main className={"tarot-main " + (revealed ? "has-reading" : "")}>
          <section className="tarot-table" aria-label="塔罗牌桌">
            <div className="tarot-table-orbit" aria-hidden="true" />
            <div className="tarot-table-heading">
              <span className="chapter">GUANXING / TAROT</span>
              <h1>
                {revealed
                  ? "牌已展开，答案从这里说起。"
                  : reading
                    ? "让直觉，停在一张牌上。"
                    : "把此刻的问题，交给一组牌。"}
              </h1>
              <p>
                {reading
                  ? reading.question
                  : "洗牌、选牌、揭示。留一点安静，看看新的视角。"}
              </p>
            </div>
            {!reading ? (
              <form className="tarot-start" onSubmit={begin}>
                <div
                  className={
                    "tarot-deck-stack " + (shuffling ? "is-shuffling" : "")
                  }
                  aria-hidden="true"
                >
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i} style={{ "--i": i } as CSSProperties}>
                      <CardBack />
                    </div>
                  ))}
                </div>
                <label className="tarot-question-label">
                  你在意的事
                  <textarea
                    required
                    maxLength={1000}
                    rows={2}
                    value={question}
                    disabled={busy || !!creation.current}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="比如：面对眼前这份工作机会，我该留意什么？"
                  />
                </label>
                <fieldset
                  className="tarot-spread-options"
                  disabled={busy || !!creation.current}
                >
                  <legend>选择一个展开的方式</legend>
                  {tarotSpreads.map((s) => (
                    <label
                      key={s.id}
                      className={spreadId === s.id ? "chosen" : ""}
                    >
                      <input
                        type="radio"
                        name="spread"
                        value={s.id}
                        checked={spreadId === s.id}
                        onChange={() => setSpreadId(s.id)}
                      />
                      <span className="tarot-spread-mini" aria-hidden="true">
                        {s.positions.map((_, i) => (
                          <i key={i} />
                        ))}
                      </span>
                      <strong>{s.name}</strong>
                      <small>{s.caption}</small>
                    </label>
                  ))}
                </fieldset>
                <div className="tarot-spread-guide" aria-live="polite">
                  <span>这组牌会看</span>
                  <p>{spread.positions.join(" → ")}</p>
                  <small>
                    {spreadId === "choice"
                      ? "在问题里写清 A 和 B 分别是什么，比如留下或换工作。"
                      : spreadId === "relationship"
                        ? "可以补充你们目前的相处情况，不必提供对方的私人信息。"
                        : "一句问题就能开始；如果有背景或想看的时间范围，也可以一起写下。"}
                  </small>
                </div>
                <div className="tarot-start-footer">
                  <label className="tarot-check">
                    <input
                      type="checkbox"
                      checked={reversed}
                      disabled={busy || !!creation.current}
                      onChange={(e) => setReversed(e.target.checked)}
                    />
                    包含逆位
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !question.trim()}
                  >
                    {busy ? <LoaderCircle className="spin" size={17} /> : null}
                    {creation.current && !busy ? "重试洗牌" : "洗牌，开始选择"}
                    <ArrowUpRight size={17} />
                  </button>
                </div>
                <p className="tarot-privacy">
                  问题、牌面与对话会保存到你的账号，主动解读时交给本站配置的
                  AI。抽牌本身不消耗解读次数。
                </p>
              </form>
            ) : (
              <>
                <div
                  className={
                    "tarot-spread-table count-" + spread.positions.length
                  }
                  aria-label={spread.name}
                >
                  {spread.positions.map((position, i) => {
                    const draw = reading.cards[i],
                      card = tarotDeck.find((c) => c.id === draw?.cardId),
                      picked = selected[i] !== undefined;
                    return (
                      <div className="tarot-position" key={i}>
                        <span className="tarot-position-label">
                          <em>{String(i + 1).padStart(2, "0")}</em>
                          {position}
                        </span>
                        <button
                          ref={(el) => {
                            slots.current[i] = el;
                          }}
                          className={
                            "tarot-slot " +
                            (picked ? "is-picked " : "") +
                            (revealed ? "is-revealed" : "")
                          }
                          style={
                            {
                              "--delay": `${i * 140}ms`,
                              "--fly-x": `${flights[i]?.x || 0}px`,
                              "--fly-y": `${flights[i]?.y || 180}px`,
                            } as CSSProperties
                          }
                          disabled={!revealed}
                          onClick={() => setDetail(i)}
                          aria-label={
                            card
                              ? `${position}：${card.name}，${draw.reversed ? "逆位" : "正位"}，查看牌义`
                              : `${position}，${picked ? "已选中" : "等待选牌"}`
                          }
                        >
                          <div
                            className={
                              "tarot-card-travel " +
                              (picked && !revealed ? "flying" : "")
                            }
                          >
                            <div className="tarot-card-flipper">
                              <div className="tarot-card-side back">
                                <CardBack />
                              </div>
                              <div className="tarot-card-side face">
                                {card && (
                                  <img
                                    src={`${import.meta.env.BASE_URL}assets/tarot/${card.id}.jpg`}
                                    alt={card.name}
                                    className={draw.reversed ? "reversed" : ""}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                          {!picked && (
                            <span className="tarot-slot-empty">
                              {i === selected.length ? "下一张，落在这里" : "✧"}
                            </span>
                          )}
                        </button>
                        <div className="tarot-card-name">
                          {card ? (
                            <>
                              {card.name}
                              <small>{draw.reversed ? "逆位" : "正位"}</small>
                            </>
                          ) : (
                            <span>{picked ? "已选中" : "等待揭示"}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!revealed ? (
                  <div className="tarot-selection">
                    <div className="tarot-selection-heading">
                      <span>
                        已选 {selected.length} / {spread.positions.length}
                      </span>
                      <span>滑过牌背，选你想停留的那一张。</span>
                      <button
                        className="tarot-text-button"
                        disabled={!selected.length || busy}
                        onClick={() => {
                          selectedRef.current = selectedRef.current.slice(
                            0,
                            -1,
                          );
                          setSelected(selectedRef.current);
                          setFlights((f) => f.slice(0, -1));
                        }}
                      >
                        <RotateCcw size={14} />
                        撤回上一张
                      </button>
                    </div>
                    <div className="tarot-fan" aria-label="选择卡牌">
                      {Array.from(
                        { length: Math.min(15, 78 - page * 15) },
                        (_, i) => {
                          const index = page * 15 + i;
                          const offset =
                            i - (Math.min(15, 78 - page * 15) - 1) / 2;
                          return (
                            <button
                              key={index}
                              disabled={
                                busy ||
                                selected.includes(index) ||
                                selected.length >= spread.positions.length
                              }
                              className={
                                "tarot-fan-card " +
                                (selected.includes(index) ? "taken" : "")
                              }
                              style={
                                {
                                  "--fan-i": offset,
                                  "--fan-y": `${offset * offset * 0.75}px`,
                                  "--deal-delay": `${i * 28}ms`,
                                } as CSSProperties
                              }
                              aria-label={`选择第 ${index + 1} 张牌`}
                              onClick={(e) => pick(index, e.currentTarget)}
                            >
                              <CardBack />
                            </button>
                          );
                        },
                      )}
                    </div>
                    <div className="tarot-selection-footer">
                      <div className="tarot-deck-pager">
                        <button
                          aria-label="上一组牌"
                          disabled={!page || busy}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <span>
                          {page * 15 + 1} — {Math.min(78, (page + 1) * 15)} / 78
                        </span>
                        <button
                          aria-label="下一组牌"
                          disabled={page === 5 || busy}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <button
                        className="primary"
                        disabled={
                          selected.length !== spread.positions.length || busy
                        }
                        onClick={() => void reveal()}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : null}
                        揭开这组牌
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tarot-revealed-note">
                    <span>这组牌已保存，刷新与追问都会沿用。</span>
                    <span>点牌面，查看正逆位含义。</span>
                  </div>
                )}
              </>
            )}
            {error && (
              <div className="tarot-error" role="alert">
                {error}
                {creation.current && (
                  <button
                    className="tarot-text-button"
                    onClick={() => {
                      creation.current = null;
                      setError("");
                    }}
                  >
                    重新填写
                  </button>
                )}
              </div>
            )}
          </section>
          {revealed && (
            <section className="tarot-reading" aria-label="塔罗解读">
              <header>
                <span className="chapter">READING / 与牌面交谈</span>
                <h2>说说，这组牌与你的事。</h2>
              </header>
              <div className="tarot-messages" aria-live="polite">
                {!messages.length && !running ? (
                  <div className="tarot-reading-intro">
                    <p>
                      先看这组牌一起在说什么，再聊你最在意的细节。哪里没听明白、哪里与你的情况不同，都可以接着说。
                    </p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void send(
                          `结合这组完整牌阵，直接回答我最初的问题：${reading.question}`,
                        )
                      }
                    >
                      解读整组牌
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                ) : (
                  messages.map((m, index) => (
                    <article key={m.id} className={"tarot-message " + m.role}>
                      <span>{m.role === "user" ? "你" : "观星"}</span>
                      {m.role === "assistant" ? (
                        <ReadingReply
                          text={m.content}
                          kind="tarot"
                          question={[
                            reading.question,
                            ...messages
                              .slice(0, index)
                              .filter((m) => m.role === "user")
                              .slice(-1)
                              .map((m) => m.content),
                          ].join("\n")}
                          latest={index === messages.length - 1}
                          disabled={busy || running || !!pending.current}
                          onDraft={continueWith}
                        />
                      ) : (
                        <ReadingText text={m.content} />
                      )}
                    </article>
                  ))
                )}
                {running && (
                  <div className="tarot-thinking">
                    <LoaderCircle className="spin" size={16} />
                    {messages.some((m) => m.role === "assistant")
                      ? "正在接着你的问题看这组牌…"
                      : "正在结合整组牌面解读…"}
                    <button
                      className="tarot-text-button"
                      onClick={() =>
                        void api
                          .cancelJob(job!.id)
                          .then(() => setPollTick((t) => t + 1))
                          .catch(report)
                      }
                    >
                      <Square size={12} />
                      停止
                    </button>
                  </div>
                )}
                {pollError && (
                  <button
                    className="tarot-text-button"
                    onClick={() => setPollTick((t) => t + 1)}
                  >
                    连接暂时中断，点击重新获取进度
                  </button>
                )}
                <div ref={scrollEnd} />
              </div>
              <form
                className="tarot-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(draft);
                }}
              >
                <textarea
                  ref={composer}
                  aria-label="继续询问这组牌"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={6000}
                  rows={3}
                  disabled={busy || running || !!pending.current}
                  placeholder="哪一句想细聊？也可以补充眼前的情况……"
                />
                <div>
                  <span>同一组牌，可以慢慢聊。</span>
                  <button
                    disabled={
                      busy || running || (!draft.trim() && !pending.current)
                    }
                    aria-label={pending.current ? "重试发送" : "发送问题"}
                    type="submit"
                  >
                    {busy ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <ArrowUp size={18} />
                    )}
                  </button>
                </div>
                {pending.current && !busy && (
                  <button
                    type="button"
                    className="tarot-text-button"
                    onClick={() => void send(pending.current!.content)}
                  >
                    重试刚才的问题
                  </button>
                )}
              </form>
              <button
                className="tarot-text-button tarot-memory-link"
                onClick={() => setMemoryOpen(true)}
              >
                记住的事
                {memories.some((m) => m.status === "pending")
                  ? " · 有内容待你确认"
                  : ""}
              </button>
              <small className="tarot-disclaimer">
                AI 生成 · 牌面象征解读，供参考
              </small>
            </section>
          )}
          <footer className="tarot-source">
            牌面 / Pamela Colman Smith · 1909 原版扫描{" "}
            <a
              href={`${import.meta.env.BASE_URL}assets/tarot/sources.json`}
              target="_blank"
              rel="noreferrer"
            >
              来源与授权 ↗
            </a>
          </footer>
        </main>
      )}
      {memoryOpen && (
        <Modal title="记住的事" onClose={() => setMemoryOpen(false)}>
          <div className="tarot-history tarot-memories">
            <h2>只记住，你确认过的事。</h2>
            <p>与紫微解读共用。牌面推断不会自动成为你的个人资料。</p>
            {!memories.length && (
              <p>还没有保存的内容。你可以在对话里说「请记住……」。</p>
            )}
            {memories.map((m) => (
              <div key={m.id}>
                <section>
                  <p>{m.content}</p>
                  <small>
                    {m.status === "pending" ? "待你确认" : "已记住"}
                  </small>
                </section>
                {m.status === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() => void changeMemory(m.id)}
                  >
                    确认
                  </button>
                )}
                <button
                  disabled={busy}
                  aria-label={`忘记：${m.content}`}
                  onClick={() => {
                    if (confirm("忘记这条内容？"))
                      void changeMemory(m.id, true);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {historyOpen && (
        <Modal title="我的塔罗" onClose={() => setHistoryOpen(false)}>
          <div className="tarot-history">
            <h2>留在这里的每一次提问。</h2>
            {!records.length ? (
              <p>还没有记录。第一组牌，从此刻开始。</p>
            ) : (
              records.map((s) => (
                <div key={s.id}>
                  <button onClick={() => void openRecord(s.id)}>
                    <span>{s.tarot?.question}</span>
                    <small>
                      {new Date(s.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                      {
                        tarotSpreads.find((p) => p.id === s.tarot?.spreadId)
                          ?.name
                      }{" "}
                      · {s.tarot?.status === "revealed" ? "已揭示" : "待选牌"}
                    </small>
                  </button>
                  <button
                    aria-label={`删除记录：${s.title}`}
                    onClick={() => {
                      if (confirm("删除这组牌和相关对话？"))
                        void api
                          .deleteSession(s.id)
                          .then(() => {
                            setRecords((old) =>
                              old.filter((r) => r.id !== s.id),
                            );
                            if (session?.id === s.id) reset();
                          })
                          .catch(report);
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
      {face && faceCard && (
        <Modal title={faceCard.name} onClose={() => setDetail(null)}>
          <div className="tarot-card-detail">
            <img
              src={`${import.meta.env.BASE_URL}assets/tarot/${faceCard.id}.jpg`}
              className={face.reversed ? "reversed" : ""}
              alt={faceCard.name}
            />
            <div>
              <span className="chapter">
                {face.position} / {face.reversed ? "逆位" : "正位"}
              </span>
              <h2>{faceCard.name}</h2>
              <p>{faceCard.keywords.join(" · ")}</p>
              <ul>
                {(face.reversed ? faceCard.reversed : faceCard.upright).map(
                  (t) => (
                    <li key={t}>{t}</li>
                  ),
                )}
              </ul>
              <button
                className="primary"
                disabled={busy || running}
                onClick={() => {
                  setDetail(null);
                  continueWith(
                    `结合我的问题，具体说说${face.position}上的${faceCard.name}${face.reversed ? "逆位" : "正位"}。`,
                  );
                }}
              >
                围绕这张继续聊
                <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
