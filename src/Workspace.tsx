import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  LogOut,
  Send,
  Square,
  Check,
  X,
  Download,
  RefreshCw,
  KeyRound,
  Pencil,
  LoaderCircle,
  MessageSquare,
  Bookmark,
  Cpu,
  Activity,
  UserRound,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { ChartInput } from "./lib/chart";
import { workspaceApi as api, WorkspaceError } from "./workspace-api";
import type {
  Dashboard,
  Memory,
  ModelDraft,
  ModelProfile,
  RunResult,
  Session,
  SessionDetail,
  UsageSource,
  Health,
  Account,
  SiteSettings,
  AgentJob,
  AccountUsage,
} from "./workspace-api";
import "./workspace.css";

type Tab = "chat" | "memories" | "models" | "usage" | "account" | "site";
type Gate =
  | "loading"
  | "unavailable"
  | "setup"
  | "login"
  | "register"
  | "ready"
  | "forbidden";
const tabs: Array<{ id: Tab; title: string; icon: typeof MessageSquare }> = [
  { id: "chat", title: "对话", icon: MessageSquare },
  { id: "memories", title: "记忆", icon: Bookmark },
  { id: "models", title: "模型", icon: Cpu },
  { id: "usage", title: "用量", icon: Activity },
  { id: "account", title: "账号", icon: UserRound },
  { id: "site", title: "站点管理", icon: Settings2 },
];
const sourceLabels: Record<UsageSource, string> = {
  provider: "服务商返回",
  estimate: "估算用量",
  unknown: "待核实 / 预留",
};
const statusLabels: Record<string, string> = {
  queued: "等待处理",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  success: "成功",
  error: "失败",
  ok: "成功",
  reserved: "额度已预留",
  "interrupted-reservation": "运行中断 · 保留预留",
  "network-unknown-reservation": "网络状态待核实 · 保留预留",
  "invalid-response-reservation": "响应无效 · 保留预留",
  "estimated-reservation": "估算 · 保留预留",
};
const blankModel: ModelDraft = {
  name: "",
  baseUrl: "",
  model: "",
  enabled: true,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
  currency: "USD",
  dailyTokenLimit: 0,
  dailyCostLimit: 0,
};
const number = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("zh-CN");
const money = (value: number | null | undefined, currency: string) =>
  value == null
    ? "未能计价"
    : `${currency} ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
const ledgerTokens = (value: number | null | undefined, source: UsageSource) =>
  source === "unknown"
    ? value != null && value > 0
      ? `预留 ${number(value)}`
      : "—"
    : number(value);
const ledgerCost = (
  value: number | null | undefined,
  currency: string,
  source: UsageSource,
) =>
  source === "unknown"
    ? value != null && value > 0
      ? `预留 ${money(value, currency)}`
      : "无法确认"
    : value === 0
      ? `${currency} 未计价 / 0 估算`
      : money(value, currency);
const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const messageFor = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";

type DeleteTarget =
  { kind: "session"; item: Session } | { kind: "model"; item: ModelProfile };
function DeleteConfirmation({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
    };
  }, []);
  const session = target.kind === "session";
  return (
    <dialog
      ref={dialog}
      className="ws-confirm-dialog"
      aria-labelledby="ws-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="ws-confirm-title">
        {session ? "删除这段对话？" : "移除这个模型？"}
      </h2>
      <p>
        {session
          ? `“${target.item.title}”的消息、运行记录与关联记忆将被删除，用量账本仍会保留。`
          : `“${target.item.name}”如有历史调用，会被停用并保留账本；没有历史的配置将被删除。`}
      </p>
      <div className="ws-row-actions">
        <button
          className="ws-button"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="ws-button primary"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "正在处理…" : session ? "确认删除" : "确认移除"}
        </button>
      </div>
    </dialog>
  );
}

function MemoryRow({
  memory,
  busy,
  onSave,
  onDelete,
}: {
  memory: Memory;
  busy: boolean;
  onSave: (id: string, content: string, active: boolean) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  useEffect(() => {
    setContent(memory.content);
  }, [memory.content]);
  return (
    <article className="ws-memory-row">
      <div className="ws-memory-meta">
        <span
          className={memory.status === "pending" ? "ws-pending" : "ws-active"}
        >
          {memory.status === "pending" ? "等待你确认" : "已确认"}
        </span>
        <span>{memory.sessionId ? "会话记忆" : "我的跨会话记忆"}</span>
        <span>{memory.hasEmbedding ? "已建立向量" : "未建立向量"}</span>
        <time>{time(memory.updatedAt)}</time>
      </div>
      {editing ? (
        <textarea
          aria-label="编辑记忆内容"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          maxLength={4000}
        />
      ) : (
        <p className="ws-memory-content">{memory.content}</p>
      )}
      <div className="ws-row-actions">
        {memory.status === "pending" && (
          <button
            className="ws-action gold"
            disabled={busy || !content.trim()}
            onClick={async () => {
              if (await onSave(memory.id, content, true)) setEditing(false);
            }}
          >
            <Check size={14} />
            确认并使用
          </button>
        )}
        {editing ? (
          <>
            <button
              className="ws-action"
              disabled={busy || !content.trim()}
              onClick={async () => {
                if (await onSave(memory.id, content, false)) setEditing(false);
              }}
            >
              <Check size={14} />
              保存修改
            </button>
            <button
              className="ws-action"
              disabled={busy}
              onClick={() => {
                setContent(memory.content);
                setEditing(false);
              }}
            >
              <X size={14} />
              取消
            </button>
          </>
        ) : (
          <button
            className="ws-action"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            编辑
          </button>
        )}
        <button
          className="ws-action danger"
          disabled={busy}
          onClick={() => onDelete(memory.id)}
        >
          <Trash2 size={14} />
          {memory.status === "pending" ? "拒绝" : "删除"}
        </button>
      </div>
    </article>
  );
}

function ServerKeyForm({
  model,
  onChange,
  onError,
}: {
  model: ModelProfile;
  onChange: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    try {
      await api.saveSecret(model.id, key.trim());
      setKey("");
      setEditing(false);
      await onChange();
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="ws-secret">
      <div className="ws-row-actions">
        <span className={model.hosted ? "ws-active" : "ws-pending"}>
          <KeyRound size={13} />{" "}
          {model.hosted ? "服务密钥已配置" : "尚未配置服务密钥"}
        </span>
        <button
          className="ws-action"
          disabled={working}
          onClick={() => {
            setKey("");
            setEditing(!editing);
          }}
        >
          {editing ? "收起" : model.hosted ? "更换密钥" : "配置密钥"}
        </button>
      </div>
      {editing && (
        <form onSubmit={save} className="ws-secret-form">
          <label>
            新的 API Key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              value={key}
              onChange={(event) => setKey(event.target.value)}
              maxLength={2048}
              placeholder="密钥不会回显"
            />
          </label>
          <p className="ws-muted">
            加密保存在服务器，供站点调用。普通用户无法查看。先设置每日 token
            上限，再启用共享服务。
          </p>
          <div className="ws-row-actions">
            <button
              className="ws-button primary"
              disabled={working || !key.trim()}
            >
              保存密钥
            </button>
            {model.hosted && (
              <button
                className="ws-button"
                type="button"
                disabled={working}
                onClick={async () => {
                  setWorking(true);
                  try {
                    await api.clearSecret(model.id);
                    setKey("");
                    setEditing(false);
                    await onChange();
                  } catch (error) {
                    onError(error);
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                清除服务密钥
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordForm({
  onSaved,
  onError,
}: {
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <form
      className="ws-account-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (next !== confirm) {
          onError(new Error("两次输入的新密码不一致。"));
          return;
        }
        setWorking(true);
        try {
          await api.changePassword(current, next);
          setCurrent("");
          setNext("");
          setConfirm("");
          onSaved();
        } catch (error) {
          onError(error);
        } finally {
          setWorking(false);
        }
      }}
    >
      <h2>修改密码</h2>
      <label>
        当前密码
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label>
        新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={1024}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          placeholder="至少 12 个字符"
        />
      </label>
      <label>
        确认新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </label>
      <button className="ws-button primary" disabled={working}>
        更新密码
      </button>
    </form>
  );
}

function AccountRow({
  user,
  selfId,
  onChange,
  onError,
}: {
  user: Account;
  selfId?: string;
  onChange: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <article className="ws-user-row">
      <div className="ws-user-title">
        <div>
          <strong>{user.username}</strong>
          <span>
            {user.role === "admin" ? "管理员" : "普通用户"}
            {user.id === selfId ? " · 当前账号" : ""}
          </span>
        </div>
        <span className={user.disabled ? "ws-pending" : "ws-active"}>
          {user.disabled ? "已停用" : "正常"}
        </span>
      </div>
      {user.createdAt && (
        <p className="ws-muted">注册于 {time(user.createdAt)}</p>
      )}
      {user.id !== selfId && (
        <div className="ws-row-actions">
          <button
            className="ws-action"
            disabled={working}
            onClick={async () => {
              setWorking(true);
              try {
                await api.updateUser(user.id, !user.disabled);
                await onChange();
              } catch (error) {
                onError(error);
              } finally {
                setWorking(false);
              }
            }}
          >
            {user.disabled ? "恢复账号" : "停用账号"}
          </button>
          <button
            className="ws-action"
            disabled={working}
            onClick={() => {
              setResetting(!resetting);
              setPassword("");
            }}
          >
            {resetting ? "取消重置" : "重置密码"}
          </button>
        </div>
      )}
      {resetting && (
        <form
          className="ws-reset-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setWorking(true);
            try {
              await api.resetUserPassword(user.id, password);
              setPassword("");
              setResetting(false);
              await onChange();
            } catch (error) {
              onError(error);
            } finally {
              setWorking(false);
            }
          }}
        >
          <label>
            为该用户设置新密码
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={1024}
              placeholder="至少 12 个字符"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="ws-button" disabled={working}>
            确认重置并退出旧登录
          </button>
        </form>
      )}
    </article>
  );
}

export default function Workspace({
  initialTab,
  birth,
  initialQuestion,
  onExit,
}: {
  initialTab: "agent" | "admin";
  birth?: ChartInput;
  initialQuestion?: string;
  onExit: () => void;
}) {
  const [gate, setGate] = useState<Gate>("loading");
  const [health, setHealth] = useState<Health | null>(null);
  const [username, setUsername] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [consent, setConsent] = useState(false);
  const [accountUsage, setAccountUsage] = useState<AccountUsage | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [users, setUsers] = useState<Account[]>([]);
  const [activeJob, setActiveJob] = useState<AgentJob | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  const [pollPaused, setPollPaused] = useState(false);
  const pendingSubmission = useRef<{
    sessionId: string;
    modelId: string;
    content: string;
    idempotencyKey: string;
  } | null>(null);
  const publicMode = health?.mode === "public";
  const isAdmin = health?.user?.role === "admin";
  const canManageModels = !publicMode || isAdmin;
  const [tab, setTab] = useState<Tab>(
    initialTab === "admin" ? "usage" : "chat",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [attachBirth, setAttachBirth] = useState(
    Boolean(birth && initialQuestion),
  );
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState(initialQuestion || "");
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [memoryFilter, setMemoryFilter] = useState<
    "all" | "active" | "pending"
  >("all");
  const [newMemory, setNewMemory] = useState("");
  const [memoryScope, setMemoryScope] = useState<"global" | "session">(
    "global",
  );
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft>({ ...blankModel });
  const runController = useRef<AbortController | null>(null);
  const selectedId = useRef<string | null>(null);
  const alive = useRef(true);
  const accountEpoch = useRef(0);
  const messageEnd = useRef<HTMLDivElement>(null);
  const currentModel = models.find((model) => model.id === modelId);
  const activeJobRef = useRef<AgentJob | null>(null);
  activeJobRef.current = activeJob;
  const visibleTabs = tabs.filter((item) => {
    if (
      initialTab === "admin" &&
      !["models", "usage", "account", "site"].includes(item.id)
    )
      return false;
    if (item.id === "models") return canManageModels;
    if (item.id === "account") return publicMode;
    if (item.id === "site") return publicMode && isAdmin;
    return true;
  });
  const publicModelReady = Boolean(
    currentModel?.enabled && currentModel?.hosted,
  );
  const displayJob =
    activeJob && (!sessionId || activeJob.sessionId === sessionId)
      ? activeJob
      : null;
  const latestRun = detail?.runs.reduce(
    (latest, run) => (run.createdAt > latest.createdAt ? run : latest),
    detail.runs[0],
  );
  const pendingCount = memories.filter(
    (memory) => memory.status === "pending",
  ).length;

  function report(error: unknown) {
    if (!alive.current) return;
    if (error instanceof WorkspaceError && error.status === 401) {
      accountEpoch.current++;
      setGate("login");
      setDeleteTarget(null);
      setApiKey("");
      setDetail(null);
      setDashboard(null);
      setSessions([]);
      setModels([]);
      setMemories([]);
      setUsers([]);
      setSiteSettings(null);
      setAccountUsage(null);
      setLastRun(null);
      setPrompt("");
      setTitle("");
      setNewMemory("");
      setSessionId(null);
      selectedId.current = null;
      pendingSubmission.current = null;
      setActiveJob(null);
      setRunning(false);
      setHealth((current) =>
        current ? { ...current, authenticated: false, user: null } : current,
      );
    }
    setError(messageFor(error));
  }
  async function loadAll(currentHealth = health) {
    const epoch = accountEpoch.current;
    const online = currentHealth?.mode === "public";
    const loaded = await Promise.all([
      initialTab === "admin"
        ? Promise.resolve({ sessions: [] as Session[] })
        : api.sessions(),
      api.models(),
      initialTab === "admin"
        ? Promise.resolve({ memories: [] as Memory[] })
        : api.memories(),
      online && currentHealth?.user?.role === "admin"
        ? api.adminUsage()
        : api.usage(),
      online ? api.account() : Promise.resolve(null),
      online && initialTab !== "admin"
        ? api.activeJobs()
        : Promise.resolve(null),
    ]).catch((error) => {
      if (epoch !== accountEpoch.current) return null;
      throw error;
    });
    if (!loaded || !alive.current || epoch !== accountEpoch.current) return;
    const [
      sessionData,
      modelData,
      memoryData,
      usageData,
      accountData,
      jobsData,
    ] = loaded;
    setSessions(sessionData.sessions);
    setModels(modelData.models);
    setMemories(memoryData.memories);
    setDashboard(usageData);
    setAccountUsage(accountData);
    const pending = jobsData?.jobs.find(
      (job) => job.status === "queued" || job.status === "running",
    );
    if (pending) {
      setActiveJob(pending);
      setRunning(true);
    }
    setModelId((current) =>
      modelData.models.some(
        (model) =>
          model.id === current && model.enabled && (!online || model.hosted),
      )
        ? current
        : modelData.models.find(
            (model) => model.enabled && (!online || model.hosted),
          )?.id || "",
    );
    if (
      online &&
      !initialQuestion &&
      !selectedId.current &&
      sessionData.sessions.length
    ) {
      let remembered: string | null = null;
      try {
        remembered = sessionStorage.getItem(
          `guanxing-session-${currentHealth?.user?.id}`,
        );
      } catch {
        /* Private browser storage may be unavailable. */
      }
      const id =
        pending?.sessionId ||
        sessionData.sessions.find((item) => item.id === remembered)?.id ||
        sessionData.sessions[0].id;
      selectedId.current = id;
      setSessionId(id);
    }
  }
  async function checkHealth() {
    const epoch = accountEpoch.current;
    setGate("loading");
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const health = await api.health(controller.signal);
      if (!health.ok || typeof health.needsSetup !== "boolean")
        throw new Error("服务状态不完整。");
      if (!alive.current || epoch !== accountEpoch.current) return;
      setHealth(health);
      if (
        health.mode === "public" &&
        initialTab === "admin" &&
        health.authenticated &&
        health.user?.role !== "admin"
      ) {
        setGate("forbidden");
        return;
      }
      if (health.needsSetup) setGate("setup");
      else if (health.authenticated) {
        try {
          await loadAll(health);
          if (alive.current && epoch === accountEpoch.current) setGate("ready");
        } catch (error) {
          if (epoch === accountEpoch.current) {
            setGate("login");
            report(error);
          }
        }
      } else setGate("login");
    } catch (error) {
      if (alive.current && epoch === accountEpoch.current) {
        setGate("unavailable");
        setError(
          controller.signal.aborted
            ? "服务响应超时，请稍后重新连接。"
            : messageFor(error),
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  useEffect(() => {
    alive.current = true;
    void checkHealth();
    return () => {
      alive.current = false;
      runController.current?.abort();
    };
  }, []);
  useEffect(() => {
    setApiKey("");
  }, [modelId, currentModel?.baseUrl]);
  useEffect(() => {
    if (gate !== "ready") return;
    if (!visibleTabs.some((item) => item.id === tab))
      setTab(initialTab === "admin" ? "usage" : "chat");
  }, [gate, publicMode, isAdmin, tab, initialTab]);
  useEffect(() => {
    if (!sessionId || gate !== "ready") return;
    const controller = new AbortController();
    setDetailLoading(true);
    api
      .session(sessionId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && selectedId.current === sessionId) {
          setDetail(data);
          const pending = data.jobs?.find(
            (job) => job.status === "queued" || job.status === "running",
          );
          if (pending) {
            setActiveJob(pending);
            setRunning(true);
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) report(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [sessionId, gate]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
  }, [detail?.messages.length, running, lastRun]);

  useEffect(() => {
    if (publicMode && !editingModelId && !modelDraft.name)
      setModelDraft((current) => ({
        ...current,
        currency: "CNY",
        dailyTokenLimit: 200000,
      }));
  }, [publicMode]);
  useEffect(() => {
    if (gate !== "ready" || !publicMode || !isAdmin || tab !== "site") return;
    let current = true;
    Promise.all([api.siteSettings(), api.users()])
      .then(([settings, people]) => {
        if (current) {
          setSiteSettings(settings.settings);
          setUsers(people.users);
        }
      })
      .catch((error) => {
        if (current) report(error);
      });
    return () => {
      current = false;
    };
  }, [gate, publicMode, isAdmin, tab]);
  useEffect(() => {
    if (gate !== "ready" || !publicMode || !activeJob) return;
    let cancelled = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const jobId = activeJob.id;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const { job } = await api.job(jobId, controller.signal);
        if (cancelled) return;
        failures = 0;
        setPollPaused(false);
        setActiveJob(job);
        if (job.status === "queued" || job.status === "running") {
          setRunning(true);
          timer = setTimeout(() => void poll(), 2000);
          return;
        }
        setRunning(false);
        if (selectedId.current === job.sessionId) {
          const latest = await api.session(job.sessionId);
          if (!cancelled && selectedId.current === job.sessionId) {
            setDetail(latest);
            setLastRun(job.result || null);
          }
        }
        if (cancelled) return;
        if (job.status === "failed")
          setError(job.error || "这次解读未完成，你可以重新发送问题。");
        else
          setNotice(
            job.status === "cancelled"
              ? "任务已停止。已经发生的模型用量仍会记录。"
              : "解读已完成，并保存在你的对话中。",
          );
        await loadAll();
        if (!cancelled) {
          setActiveJob((current) => (current?.id === jobId ? null : current));
          if (activeJobRef.current?.id === jobId) activeJobRef.current = null;
        }
      } catch (error) {
        if (cancelled) return;
        if (
          error instanceof WorkspaceError &&
          (error.status === 401 || error.status === 404)
        ) {
          setRunning(false);
          setActiveJob(null);
          report(error);
          return;
        }
        failures++;
        if (failures >= 5) {
          setPollPaused(true);
          setNotice(
            "暂时无法取得任务进度，服务器仍会继续处理。点击刷新可重新连接。",
          );
        } else
          timer = setTimeout(
            () => void poll(),
            Math.min(failures * 2000, 10000),
          );
      } finally {
        clearTimeout(timeout);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [activeJob?.id, pollVersion, gate, publicMode]);
  async function stopRun() {
    if (!publicMode) {
      runController.current?.abort();
      return;
    }
    if (!activeJob) {
      setNotice("提交状态尚未确认，请刷新后查看并停止任务。");
      return;
    }
    setBusy(true);
    try {
      await api.cancelJob(activeJob.id);
      setNotice("已请求停止任务，正在确认处理状态。");
      setPollVersion((value) => value + 1);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function saveSite(event: FormEvent) {
    event.preventDefault();
    if (!siteSettings) return;
    setBusy(true);
    try {
      const { settings } = await api.saveSettings(siteSettings);
      setSiteSettings(settings);
      setHealth((current) => (current ? { ...current, ...settings } : current));
      await loadAll();
      setNotice("站点设置已保存。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setError("");
    const creating = gate === "setup" || gate === "register";
    if (creating && (password.length < 12 || password !== confirmation)) {
      setError(
        password.length < 12
          ? "密码至少需要 12 个字符。"
          : "两次输入的密码不一致。",
      );
      return;
    }
    if (gate === "register" && !consent) {
      setError("请先阅读并确认资料保存说明。");
      return;
    }
    setBusy(true);
    try {
      if (gate === "setup")
        await api.setup(
          password,
          publicMode
            ? { username: username.trim(), setupToken: setupToken.trim() }
            : undefined,
        );
      else if (gate === "register")
        await api.register(username.trim(), password);
      else await api.login(password, publicMode ? username.trim() : undefined);
      accountEpoch.current++;
      setPassword("");
      setConfirmation("");
      setSetupToken("");
      selectedId.current = null;
      setSessionId(null);
      await checkHealth();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await loadAll();
      if (sessionId) {
        const data = await api.session(sessionId);
        if (selectedId.current === sessionId) setDetail(data);
      }
      setPollPaused(false);
      setPollVersion((value) => value + 1);
      setNotice("已刷新数据。");
    } catch (error) {
      report(error);
    } finally {
      setRefreshing(false);
    }
  }
  function chooseSession(id: string) {
    selectedId.current = id;
    setSessionId(id);
    if (publicMode) {
      try {
        sessionStorage.setItem(`guanxing-session-${health?.user?.id}`, id);
      } catch {
        /* Session selection is optional. */
      }
    }
    setDetail(null);
    setLastRun(null);
    setTab("chat");
    setError("");
    setNotice("");
  }
  async function createSession() {
    const { session } = await api.createSession({
      title: title.trim() || undefined,
      ...(attachBirth && birth ? { birth } : {}),
    });
    setSessions((current) => [session, ...current]);
    selectedId.current = session.id;
    setSessionId(session.id);
    setDetail({ session, messages: [], runs: [] });
    setLastRun(null);
    setTitle("");
    setTab("chat");
    return session;
  }
  async function newSession() {
    setBusy(true);
    setError("");
    try {
      await createSession();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function removeSession(session: Session) {
    setBusy(true);
    setError("");
    try {
      await api.deleteSession(session.id);
      setDeleteTarget(null);
      if (session.id === sessionId) {
        selectedId.current = null;
        setSessionId(null);
        setDetail(null);
        setLastRun(null);
      }
      await loadAll();
      setNotice("会话已删除，用量账本已保留。");
    } catch (error) {
      setDeleteTarget(null);
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      !prompt.trim() ||
      !currentModel?.enabled ||
      (!publicMode && !apiKey.trim()) ||
      (publicMode && !publicModelReady) ||
      running
    )
      return;
    const content = prompt.trim();
    const submissionEpoch = accountEpoch.current;
    const requestKey = apiKey;
    const requestModel = modelId;
    const controller = new AbortController();
    runController.current = controller;
    setRunning(true);
    setError("");
    setNotice("");
    setLastRun(null);
    let activeId = sessionId;
    try {
      if (!activeId) {
        const session = await createSession();
        activeId = session.id;
      }
      if (controller.signal.aborted)
        throw new DOMException("已停止", "AbortError");
      if (publicMode) {
        const previous = pendingSubmission.current;
        const submission =
          previous &&
          previous.sessionId === activeId &&
          previous.modelId === requestModel &&
          previous.content === content
            ? previous
            : {
                sessionId: activeId,
                modelId: requestModel,
                content,
                idempotencyKey: crypto.randomUUID(),
              };
        pendingSubmission.current = submission;
        const timeout = setTimeout(() => controller.abort(), 15000);
        let job: AgentJob;
        try {
          ({ job } = await api.enqueue(
            activeId,
            {
              content,
              modelId: requestModel,
              idempotencyKey: submission.idempotencyKey,
            },
            controller.signal,
          ));
        } finally {
          clearTimeout(timeout);
        }
        if (!alive.current) return;
        setActiveJob(job);
        activeJobRef.current = job;
        setPollPaused(false);
        setPollVersion((value) => value + 1);
        setPrompt("");
        pendingSubmission.current = null;
        void api
          .account()
          .then((data) => {
            if (alive.current && submissionEpoch === accountEpoch.current)
              setAccountUsage(data);
          })
          .catch(() => {
            /* Completion refresh will retry this counter. */
          });
        const submittedSession = await api.session(activeId);
        if (selectedId.current === activeId) setDetail(submittedSession);
        if (
          activeJobRef.current?.id === job.id &&
          ["queued", "running"].includes(activeJobRef.current.status)
        )
          setNotice("请求已提交。离开或关闭页面后仍会继续，可以稍后回来查看。");
        return;
      }
      const response = await api.run(
        activeId,
        { content, modelId: requestModel, apiKey: requestKey },
        controller.signal,
      );
      if (!alive.current) return;
      setLastRun(response);
      setPrompt("");
      setDetail(await api.session(activeId));
      await loadAll();
    } catch (error) {
      if (!alive.current) return;
      if (controller.signal.aborted)
        setNotice(
          publicMode
            ? "提交状态暂未确认。请刷新查看任务；重试同一条消息会使用原请求编号。"
            : "已停止等待并通知服务端取消运行。正在执行的调用可能已经产生用量，请查看账本。",
        );
      else report(error);
      if (activeId) {
        try {
          const data = await api.session(activeId);
          if (selectedId.current === activeId) setDetail(data);
          await loadAll();
        } catch {
          /* Keep the original request error visible. */
        }
      }
    } finally {
      if (
        alive.current &&
        (!publicMode ||
          !activeJobRef.current ||
          !["queued", "running"].includes(activeJobRef.current.status))
      )
        setRunning(false);
      if (runController.current === controller) runController.current = null;
    }
  }
  async function saveMemory(id: string, content: string, active: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.updateMemory(id, {
        content: content.trim(),
        ...(active ? { status: "active" as const } : {}),
      });
      await loadAll();
      setNotice(active ? "这条记忆已由你确认。" : "记忆已更新。");
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function removeMemory(id: string) {
    setBusy(true);
    setError("");
    try {
      await api.deleteMemory(id);
      await loadAll();
      setNotice("记忆已删除。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function addMemory(event: FormEvent) {
    event.preventDefault();
    if (!newMemory.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.createMemory({
        content: newMemory.trim(),
        ...(memoryScope === "session" && sessionId ? { sessionId } : {}),
      });
      setNewMemory("");
      await loadAll();
      setNotice("你主动填写的记忆已保存为已确认。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function reindexMemories() {
    setBusy(true);
    setError("");
    try {
      const result = await api.reindex();
      await loadAll();
      setNotice(
        `向量索引完成：更新 ${result.updated} 条，失败 ${result.failed} 条。${result.failed ? "请检查本地 embedding 服务配置。" : ""}`,
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function saveModel(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const draft = {
        ...modelDraft,
        name: modelDraft.name.trim(),
        baseUrl: modelDraft.baseUrl.trim(),
        model: modelDraft.model.trim(),
      };
      if (editingModelId) await api.updateModel(editingModelId, draft);
      else await api.createModel(draft);
      setEditingModelId(null);
      setModelDraft({
        ...blankModel,
        ...(publicMode
          ? { currency: "CNY" as const, dailyTokenLimit: 200000 }
          : {}),
      });
      setApiKey("");
      await loadAll();
      setNotice(
        publicMode
          ? "模型配置已保存。请在模型卡片中配置服务密钥。"
          : "模型配置已保存。Key 不在配置中。",
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function removeModel(model: ModelProfile) {
    setBusy(true);
    setError("");
    try {
      await api.deleteModel(model.id);
      setDeleteTarget(null);
      if (editingModelId === model.id) {
        setEditingModelId(null);
        setModelDraft({
          ...blankModel,
          ...(publicMode
            ? { currency: "CNY" as const, dailyTokenLimit: 200000 }
            : {}),
        });
      }
      await loadAll();
      setNotice("模型移除请求已完成；有历史记录的配置会保留为停用状态。");
    } catch (error) {
      setDeleteTarget(null);
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    setBusy(true);
    setError("");
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `guanxing-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("已导出你的数据。文件包含会话与记忆，请妥善保存。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    accountEpoch.current++;
    runController.current?.abort();
    setBusy(true);
    setError("");
    try {
      await api.logout();
      setApiKey("");
      setPassword("");
      setPrompt("");
      setTitle("");
      setNewMemory("");
      pendingSubmission.current = null;
      setDetail(null);
      setSessionId(null);
      selectedId.current = null;
      setSessions([]);
      setModels([]);
      setMemories([]);
      setDashboard(null);
      setLastRun(null);
      setActiveJob(null);
      setRunning(false);
      setUsers([]);
      setSiteSettings(null);
      setAccountUsage(null);
      setHealth((current) =>
        current ? { ...current, authenticated: false, user: null } : current,
      );
      setGate("login");
      setNotice("");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  function exit() {
    runController.current?.abort();
    setApiKey("");
    onExit();
  }

  return (
    <div
      className={`ws-shell ${initialTab === "admin" ? "ws-admin" : ""} ${gate === "ready" ? "ws-ready" : ""}`}
    >
      <header className="ws-header">
        <button className="ws-back" aria-label="返回首页" onClick={exit}>
          <ArrowLeft size={17} />
          <span>返回首页</span>
        </button>
        <div className="ws-brand">
          观星{" "}
          <span>
            {initialTab === "admin" ? "管理后台 / ADMIN" : "WORKSPACE"}
          </span>
        </div>
        <span className="ws-local">
          <i />
          {publicMode ? health?.user?.username || "在线观星室" : "本地工作台"}
        </span>
        {gate === "ready" && (
          <button
            className="ws-icon"
            aria-label="退出登录"
            title="退出登录"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={17} />
          </button>
        )}
      </header>
      {gate !== "ready" ? (
        <main className="ws-gate">
          <p className="ws-eyebrow">ADMINISTRATION / 站点管理</p>
          {gate === "loading" ? (
            <>
              <LoaderCircle className="ws-spin" size={26} />
              <h1>连接你的观星室</h1>
              <p>正在确认服务与登录状态。</p>
            </>
          ) : gate === "forbidden" ? (
            <>
              <ShieldCheck size={28} />
              <h1>这里是站点管理后台。</h1>
              <p>
                当前账号可以在用户页面查看命盘和对话，管理功能仅向管理员开放。
              </p>
              <button className="ws-button primary" onClick={exit}>
                返回首页 <ArrowLeft size={16} />
              </button>
              <button
                className="ws-action"
                disabled={busy}
                onClick={() => void logout()}
              >
                切换管理员账号
              </button>
            </>
          ) : gate === "unavailable" ? (
            <>
              <h1>
                暂时还没连上，
                <br />
                你的观星室。
              </h1>
              <p>
                {publicMode
                  ? "站点服务暂时不可用，请稍后重新连接。已经提交的后台任务不会因为关闭页面而取消。"
                  : "已部署的站点可以稍后重试。GitHub Pages 提供星图体验；连续对话和独立记忆需要完整服务器版本，也可以在自己的电脑上运行。"}
              </p>
              {!publicMode && (
                <div className="ws-startup">
                  <span>下载或克隆仓库，在项目目录运行</span>
                  <code>./scripts/start-local.sh</code>
                  <span>
                    脚本会创建本地配置并通过 Docker 启动服务。需要先安装并运行
                    Docker。
                  </span>
                  <a href="http://localhost:3000" className="ws-action gold">
                    打开 localhost:3000 ↗
                  </a>
                </div>
              )}
              {!publicMode && (
                <p className="ws-muted">
                  本地首次运行需要设置管理员密码。服务器部署方式见项目文档。
                </p>
              )}
              {error && (
                <p className="ws-error" role="alert">
                  {error}
                </p>
              )}
              <button className="ws-button" onClick={() => void checkHealth()}>
                <RefreshCw size={15} />
                重新连接
              </button>
            </>
          ) : (
            <>
              <h1>
                {gate === "setup"
                  ? "初始化站点管理员。"
                  : gate === "register"
                    ? "留一个自己的位置。"
                    : "登录管理后台。"}
              </h1>
              <p>
                {publicMode
                  ? gate === "setup"
                    ? "使用部署时生成的初始化口令，创建站点管理员。"
                    : gate === "register"
                      ? "创建独立账号。你的对话和确认的记忆只属于你。"
                      : "管理站点用户、解读服务和模型用量。"
                  : gate === "setup"
                    ? "创建本地管理员密码。你的会话与确认的记忆将保存在自己的 PostgreSQL 数据库中。"
                    : "使用本地管理员密码登录，继续上一次对话。"}
              </p>
              <form className="ws-auth" onSubmit={authenticate}>
                {publicMode && (
                  <label>
                    用户名
                    <input
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={32}
                      pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="3–32 位字母、数字、下划线或短横线"
                    />
                  </label>
                )}
                {publicMode && gate === "setup" && (
                  <label>
                    初始化口令
                    <input
                      type="password"
                      autoComplete="off"
                      required
                      value={setupToken}
                      onChange={(event) => setSetupToken(event.target.value)}
                      placeholder="来自服务器部署配置的 SETUP_TOKEN"
                    />
                  </label>
                )}
                <label>
                  {publicMode ? "密码" : "管理员密码"}
                  <input
                    type="password"
                    autoComplete={
                      gate === "setup" || gate === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    required
                    minLength={
                      gate === "setup" || gate === "register" ? 12 : undefined
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      gate === "setup" || gate === "register"
                        ? "至少 12 个字符"
                        : "输入你的密码"
                    }
                  />
                </label>
                {(gate === "setup" || gate === "register") && (
                  <label>
                    再次输入密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      required
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                )}
                {gate === "register" && (
                  <label className="ws-checkbox ws-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      required
                    />
                    <span>
                      我了解对话、附带的出生资料和确认的记忆会保存在本站；可在账号中导出，在对话与记忆中删除。解读内容由
                      AI 生成。
                    </span>
                  </label>
                )}
                {error && (
                  <p className="ws-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="ws-button primary" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="ws-spin" size={17} />
                  ) : (
                    <KeyRound size={17} />
                  )}
                  {gate === "setup"
                    ? "创建管理员并进入"
                    : gate === "register"
                      ? "注册并进入"
                      : "进入管理后台"}
                </button>
              </form>
              {publicMode && gate !== "setup" && (
                <div className="ws-auth-switch">
                  {gate === "register" ? (
                    <button
                      className="ws-action gold"
                      disabled={busy}
                      onClick={() => {
                        setGate("login");
                        setPassword("");
                        setConfirmation("");
                        setError("");
                      }}
                    >
                      已有账号，前往登录 ↗
                    </button>
                  ) : health?.registrationOpen && initialTab !== "admin" ? (
                    <button
                      className="ws-action gold"
                      disabled={busy}
                      onClick={() => {
                        setGate("register");
                        setPassword("");
                        setConfirmation("");
                        setError("");
                      }}
                    >
                      第一次来，创建账号 ↗
                    </button>
                  ) : (
                    <p className="ws-muted">
                      管理员账号由站点初始化时创建，普通用户请从首页进入。
                    </p>
                  )}
                  {gate === "login" && (
                    <p className="ws-muted">忘记密码可联系站点管理员重置。</p>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      ) : (
        <>
          <nav className="ws-tabs" aria-label="管理后台功能">
            {visibleTabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => {
                  setTab(item.id);
                  setError("");
                  setNotice("");
                }}
              >
                <item.icon size={16} />
                {item.title}
                {item.id === "memories" && pendingCount > 0 && (
                  <span className="ws-count">{pendingCount}</span>
                )}
              </button>
            ))}
            <button
              className="ws-refresh"
              disabled={refreshing || busy}
              aria-label="刷新管理后台"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} className={refreshing ? "ws-spin" : ""} />
            </button>
          </nav>
          {(error || notice) && (
            <div
              className={`ws-banner ${error ? "error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <span>{error || notice}</span>
              <button
                className="ws-icon"
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {tab === "chat" && (
            <main className="ws-chat-layout">
              <aside className="ws-sidebar">
                <div className="ws-side-heading">
                  <span>我的对话</span>
                  <span>{sessions.length}</span>
                </div>
                <div className="ws-new-session">
                  <input
                    aria-label="新对话名称"
                    placeholder="新对话名称（可选）"
                    value={title}
                    maxLength={100}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  {birth ? (
                    <label className="ws-checkbox">
                      <input
                        type="checkbox"
                        checked={attachBirth}
                        onChange={(event) =>
                          setAttachBirth(event.target.checked)
                        }
                      />
                      新对话附带当前命盘
                    </label>
                  ) : (
                    <p className="ws-muted">
                      回星图生成命盘后，可将它附带到新对话。
                    </p>
                  )}
                  <button
                    className="ws-button"
                    disabled={busy || (!publicMode && running)}
                    onClick={() => void newSession()}
                  >
                    <Plus size={16} />
                    新建对话
                  </button>
                </div>
                <div className="ws-session-list">
                  {sessions.length ? (
                    sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`ws-session ${session.id === sessionId ? "selected" : ""}`}
                      >
                        <button
                          className="ws-session-select"
                          disabled={!publicMode && running}
                          onClick={() => chooseSession(session.id)}
                        >
                          <strong>{session.title || "未命名对话"}</strong>
                          <span>
                            {time(session.updatedAt)}
                            {session.birth ? " · 已附命盘" : ""}
                          </span>
                        </button>
                        <button
                          className="ws-icon"
                          disabled={busy || running}
                          aria-label={`删除对话 ${session.title}`}
                          onClick={() =>
                            setDeleteTarget({ kind: "session", item: session })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="ws-empty-small">
                      还没有对话。写下第一个问题，就会为你新建一页。
                    </p>
                  )}
                </div>
              </aside>
              <section className="ws-conversation" aria-label="对话区域">
                <div className="ws-conversation-heading">
                  <div>
                    <h1>{detail?.session.title || "从一个问题开始。"}</h1>
                    <p>
                      {detail?.session.birth
                        ? `已附命盘 · ${detail.session.birth.date} · ${publicMode ? "仅在你的账号中使用" : "出生信息保存在本地数据库"}`
                        : "连续对话 · 由你确认记忆 · 工具操作可追溯"}
                    </p>
                  </div>
                  {running && (
                    <span className="ws-running">
                      <LoaderCircle size={14} className="ws-spin" />
                      {publicMode
                        ? pollPaused
                          ? "等待重连"
                          : activeJob?.status === "queued"
                            ? "正在排队"
                            : "正在解读"
                        : "正在思考"}
                    </span>
                  )}
                </div>
                <div
                  className="ws-messages"
                  aria-live="polite"
                  aria-busy={running || detailLoading}
                >
                  {detailLoading && <p className="ws-muted">正在读取对话…</p>}
                  {!detailLoading && !detail?.messages.length && (
                    <div className="ws-chat-empty">
                      <span className="ws-eyebrow">
                        A LITTLE SPACE TO THINK
                      </span>
                      <h2>
                        这张命盘，
                        <br />
                        说得明白一点。
                      </h2>
                      <p>
                        结合附带的命盘和已确认的记忆，先说推断结论，再把依据翻译成日常话。你问什么，就答什么。
                      </p>
                      <div className="ws-starters">
                        {[
                          "请完整解读这张命盘，用大白话直接讲性格、事业、感情和主要优势短板。",
                          "从这张命盘推断，我更适合什么工作，最容易卡在哪里？请直接给结论和依据。",
                        ].map((text) => (
                          <button key={text} onClick={() => setPrompt(text)}>
                            {text}
                            <span>↗</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail?.messages.map((message) => (
                    <article
                      className={`ws-message ${message.role}`}
                      key={message.id}
                    >
                      <div className="ws-message-byline">
                        <span>{message.role === "user" ? "你" : "观星"}</span>
                        <time>{time(message.createdAt)}</time>
                      </div>
                      <div className="ws-message-text">{message.content}</div>
                    </article>
                  ))}
                  {running && (
                    <div className="ws-run-note">
                      <LoaderCircle size={16} className="ws-spin" />
                      <span>
                        {publicMode
                          ? displayJob?.cancelRequested
                            ? "已请求停止，正在等待模型调用结束。"
                            : activeJob && activeJob.sessionId !== sessionId
                              ? "另一段对话正在后台处理中，完成后会保存结果。"
                              : displayJob?.status === "queued"
                                ? "请求已排队。轮到后会自动开始，关闭页面也不会丢失任务。"
                                : "正在生成解读。你可以离开页面，回来后继续查看。"
                          : "正在执行本次请求。完成后显示实际工具记录与用量；你可以随时停止。"}
                      </span>
                    </div>
                  )}
                  {!running &&
                    latestRun &&
                    latestRun.status !== "completed" && (
                      <p className="ws-run-status">
                        最近运行：
                        {statusLabels[latestRun.status] || latestRun.status}
                        {latestRun.error ? ` · ${latestRun.error}` : ""}
                      </p>
                    )}
                  {lastRun && (
                    <div className="ws-run-report">
                      <details open={lastRun.events.length > 0}>
                        <summary>
                          本次运行记录{" "}
                          <span>
                            {lastRun.events.length} 次工具操作 ·{" "}
                            {sourceLabels[lastRun.usage.usageSource]}
                          </span>
                        </summary>
                        {lastRun.events.length > 0 ? (
                          <ol>
                            {lastRun.events.map((event, index) => (
                              <li key={`${event.tool}-${index}`}>
                                <span
                                  className={
                                    event.status === "ok"
                                      ? "ws-active"
                                      : "ws-pending"
                                  }
                                >
                                  {event.status === "ok" ? "完成" : "异常"}
                                </span>
                                <code>{event.tool}</code>
                                <p>{event.summary}</p>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>本次响应未调用工具。</p>
                        )}
                        <p className="ws-muted">
                          输入{" "}
                          {ledgerTokens(
                            lastRun.usage.inputTokens,
                            lastRun.usage.usageSource,
                          )}{" "}
                          / 输出{" "}
                          {ledgerTokens(
                            lastRun.usage.outputTokens,
                            lastRun.usage.usageSource,
                          )}{" "}
                          tokens ·{" "}
                          {ledgerCost(
                            lastRun.usage.estimatedCost,
                            lastRun.usage.currency,
                            lastRun.usage.usageSource,
                          )}
                        </p>
                      </details>
                      {lastRun.memoryCandidates.length > 0 && (
                        <div className="ws-candidate-note">
                          <Bookmark size={16} />
                          <span>
                            本次提出 {lastRun.memoryCandidates.length}{" "}
                            条候选记忆。只有你确认后才会被用于后续对话。
                          </span>
                          <button
                            className="ws-action gold"
                            onClick={() => {
                              setMemoryFilter("pending");
                              setTab("memories");
                            }}
                          >
                            查看并确认 ↗
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div ref={messageEnd} />
                </div>
                <form className="ws-composer" onSubmit={send}>
                  <div className="ws-model-access">
                    <label>
                      本次模型
                      <select
                        value={modelId}
                        disabled={running}
                        onChange={(event) => setModelId(event.target.value)}
                      >
                        <option value="">选择已启用模型</option>
                        {models
                          .filter(
                            (model) =>
                              model.enabled && (!publicMode || model.hosted),
                          )
                          .map((model) => (
                            <option value={model.id} key={model.id}>
                              {model.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!publicMode && (
                      <label>
                        临时 API Key
                        <input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={apiKey}
                          disabled={running}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="只保留在当前页面内存"
                          maxLength={512}
                        />
                      </label>
                    )}
                    {publicMode && (
                      <div className="ws-allowance">
                        <span>今日解读</span>
                        <strong>
                          {accountUsage
                            ? `${Math.max(0, accountUsage.dailyRunLimit - accountUsage.usedToday)} / ${accountUsage.dailyRunLimit} 次可用`
                            : "由站点提供模型服务"}
                        </strong>
                        <small>提交计入额度，记忆由你确认</small>
                      </div>
                    )}
                  </div>
                  {!models.some(
                    (model) => model.enabled && (!publicMode || model.hosted),
                  ) &&
                    canManageModels && (
                      <button
                        type="button"
                        className="ws-action gold"
                        onClick={() => setTab("models")}
                      >
                        先配置一个模型服务 ↗
                      </button>
                    )}
                  {publicMode &&
                    !canManageModels &&
                    !models.some((model) => model.enabled && model.hosted) && (
                      <p className="ws-muted">
                        站点暂未开通解读服务，请稍后再来。
                      </p>
                    )}
                  <label className="ws-prompt-label">
                    <span className="ws-sr-only">对话内容</span>
                    <textarea
                      placeholder="说说你想了解的事…"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={3}
                      maxLength={12000}
                      disabled={running}
                      onKeyDown={(event) => {
                        if (
                          (event.ctrlKey || event.metaKey) &&
                          event.key === "Enter"
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                  </label>
                  <div className="ws-composer-bottom">
                    <p>
                      {publicMode
                        ? "AI 生成内容供参考。任务在后台继续，结果保存在你的账号。"
                        : "Key 经本机后端转发到所选服务，不保存。会话与确认的记忆保存在本地。"}
                    </p>
                    {running ? (
                      <button
                        type="button"
                        className="ws-button"
                        disabled={busy || Boolean(activeJob?.cancelRequested)}
                        onClick={() => void stopRun()}
                      >
                        <Square size={14} />
                        停止
                      </button>
                    ) : (
                      <button
                        className="ws-button primary"
                        disabled={
                          busy ||
                          !prompt.trim() ||
                          (!publicMode && !apiKey.trim()) ||
                          (publicMode && !publicModelReady) ||
                          !currentModel?.enabled
                        }
                      >
                        <Send size={15} />
                        发送
                      </button>
                    )}
                  </div>
                </form>
              </section>
            </main>
          )}
          {tab === "memories" && (
            <main className="ws-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">MEMORY / 记忆由你决定</p>
                  <h1>让有用的事，被记住。</h1>
                  <p>
                    模型提出的记忆先进入候选区。你可以改写、确认或拒绝，未经确认不会成为长期记忆。
                  </p>
                </div>
                <button
                  className="ws-button"
                  disabled={busy}
                  onClick={() => void reindexMemories()}
                >
                  <RefreshCw size={15} />
                  重建向量索引
                </button>
              </div>
              <p className="ws-embedding">
                Embedding：
                {dashboard?.embedding.configured
                  ? `${dashboard.embedding.provider} · ${dashboard.embedding.dimensions} 维`
                  : "尚未配置向量模型；当前使用文本与近期记忆检索，不提供语义检索"}
                。是否已成功建立向量，以每条记忆的状态为准。
              </p>
              <form className="ws-memory-form" onSubmit={addMemory}>
                <label>
                  主动留下一条记忆
                  <textarea
                    placeholder="例如：我偏好直接、简短的建议。"
                    value={newMemory}
                    maxLength={4000}
                    rows={3}
                    onChange={(event) => setNewMemory(event.target.value)}
                  />
                </label>
                <div className="ws-form-footer">
                  <label className="ws-inline-label">
                    适用范围
                    <select
                      value={memoryScope}
                      onChange={(event) =>
                        setMemoryScope(
                          event.target.value as "global" | "session",
                        )
                      }
                    >
                      <option value="global">所有对话</option>
                      <option value="session" disabled={!sessionId}>
                        当前对话{!sessionId ? "（先选择一个对话）" : ""}
                      </option>
                    </select>
                  </label>
                  <button
                    className="ws-button primary"
                    disabled={busy || !newMemory.trim()}
                  >
                    <Plus size={15} />
                    确认并保存
                  </button>
                </div>
              </form>
              <div className="ws-filter" aria-label="记忆筛选">
                {(["all", "pending", "active"] as const).map((value) => (
                  <button
                    key={value}
                    className={memoryFilter === value ? "active" : ""}
                    aria-pressed={memoryFilter === value}
                    onClick={() => setMemoryFilter(value)}
                  >
                    {value === "all"
                      ? "全部"
                      : value === "pending"
                        ? `待确认 ${pendingCount}`
                        : "已确认"}
                  </button>
                ))}
              </div>
              <div className="ws-memory-list">
                {memories
                  .filter(
                    (memory) =>
                      memoryFilter === "all" || memory.status === memoryFilter,
                  )
                  .map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      busy={busy}
                      onSave={saveMemory}
                      onDelete={(id) => void removeMemory(id)}
                    />
                  ))}
                {!memories.some(
                  (memory) =>
                    memoryFilter === "all" || memory.status === memoryFilter,
                ) && (
                  <div className="ws-empty-state">
                    这里还没有
                    {memoryFilter === "pending"
                      ? "待确认的"
                      : memoryFilter === "active"
                        ? "已确认的"
                        : ""}
                    记忆。你可以主动添加，或在对话后查看候选内容。
                  </div>
                )}
              </div>
            </main>
          )}
          {tab === "models" && canManageModels && (
            <main className="ws-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">MODELS / 选择自己的模型</p>
                  <h1>服务、价格、限额。</h1>
                  <p>
                    {publicMode
                      ? "配置本站使用的模型。服务密钥加密保存，每日额度控制全站调用；普通用户无需填写 Key。"
                      : "保存可复用的模型配置。API Key 在每次对话时临时输入，不写入配置或数据库。"}
                  </p>
                </div>
              </div>
              <div className="ws-model-layout">
                <section className="ws-model-list" aria-label="已配置模型">
                  {models.map((model) => (
                    <article className="ws-model-row" key={model.id}>
                      <div className="ws-model-title">
                        <h2>{model.name}</h2>
                        <span
                          className={model.enabled ? "ws-active" : "ws-muted"}
                        >
                          {model.enabled ? "已启用" : "已停用"}
                        </span>
                      </div>
                      <p>{model.model}</p>
                      <p className="ws-endpoint">{model.baseUrl}</p>
                      {publicMode && (
                        <ServerKeyForm
                          model={model}
                          onChange={async () => {
                            await loadAll();
                            setNotice("服务密钥设置已更新。");
                          }}
                          onError={report}
                        />
                      )}
                      <dl>
                        <div>
                          <dt>输入 / 输出（每百万 tokens）</dt>
                          <dd>
                            {model.inputPricePerMillion === 0 &&
                            model.outputPricePerMillion === 0
                              ? "未计价"
                              : `${model.currency} ${model.inputPricePerMillion} / ${model.outputPricePerMillion}`}
                          </dd>
                        </div>
                        <div>
                          <dt>每日上限</dt>
                          <dd>
                            {model.dailyTokenLimit
                              ? `${number(model.dailyTokenLimit)} tokens`
                              : "tokens 不限"}{" "}
                            ·{" "}
                            {model.dailyCostLimit
                              ? money(model.dailyCostLimit, model.currency)
                              : "费用不限"}
                          </dd>
                        </div>
                      </dl>
                      <div className="ws-row-actions">
                        <button
                          className="ws-action"
                          disabled={busy}
                          onClick={() => {
                            const { id, hosted: _hosted, ...draft } = model;
                            setEditingModelId(id);
                            setModelDraft(draft);
                          }}
                        >
                          <Pencil size={14} />
                          编辑
                        </button>
                        <button
                          className="ws-action danger"
                          disabled={busy || running}
                          onClick={() =>
                            setDeleteTarget({ kind: "model", item: model })
                          }
                        >
                          <Trash2 size={14} />
                          移除
                        </button>
                      </div>
                    </article>
                  ))}
                  {models.length === 0 && (
                    <div className="ws-empty-state">
                      还没有模型配置。填写服务地址与模型名，便可开始第一次对话。
                    </div>
                  )}
                </section>
                <form className="ws-model-form" onSubmit={saveModel}>
                  <h2>{editingModelId ? "编辑模型" : "添加模型"}</h2>
                  <label>
                    显示名称
                    <input
                      required
                      maxLength={100}
                      value={modelDraft.name}
                      onChange={(event) =>
                        setModelDraft({
                          ...modelDraft,
                          name: event.target.value,
                        })
                      }
                      placeholder="例如：我的日常助手"
                    />
                  </label>
                  <label>
                    服务地址
                    <input
                      required
                      type="url"
                      value={modelDraft.baseUrl}
                      onChange={(event) =>
                        setModelDraft({
                          ...modelDraft,
                          baseUrl: event.target.value,
                        })
                      }
                      placeholder="https://服务域名/v1"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    模型名称
                    <input
                      required
                      maxLength={200}
                      value={modelDraft.model}
                      onChange={(event) =>
                        setModelDraft({
                          ...modelDraft,
                          model: event.target.value,
                        })
                      }
                      placeholder="填写服务提供的模型 ID"
                    />
                  </label>
                  <div className="ws-form-grid">
                    <label>
                      输入单价 / 百万 tokens
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={modelDraft.inputPricePerMillion}
                        onChange={(event) =>
                          setModelDraft({
                            ...modelDraft,
                            inputPricePerMillion: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      输出单价 / 百万 tokens
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={modelDraft.outputPricePerMillion}
                        onChange={(event) =>
                          setModelDraft({
                            ...modelDraft,
                            outputPricePerMillion: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      计价币种
                      <select
                        value={modelDraft.currency}
                        onChange={(event) =>
                          setModelDraft({
                            ...modelDraft,
                            currency: event.target.value as "USD" | "CNY",
                          })
                        }
                      >
                        <option value="USD">USD · 美元</option>
                        <option value="CNY">CNY · 人民币</option>
                      </select>
                    </label>
                    <label>
                      每日 token 限额
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={modelDraft.dailyTokenLimit}
                        onChange={(event) =>
                          setModelDraft({
                            ...modelDraft,
                            dailyTokenLimit: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      每日费用限额
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={modelDraft.dailyCostLimit}
                        onChange={(event) =>
                          setModelDraft({
                            ...modelDraft,
                            dailyCostLimit: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="ws-muted">
                    {publicMode
                      ? "共享服务必须设置大于 0 的每日 token 上限。价格请按服务商填入；费用为估算，未区分缓存优惠，不等于实际账单。"
                      : "限额 0 表示不限；价格 0 表示未计价，不代表免费。估算费用用于个人控制，不是服务商账单。"}
                  </p>
                  <label className="ws-checkbox">
                    <input
                      type="checkbox"
                      checked={modelDraft.enabled}
                      onChange={(event) =>
                        setModelDraft({
                          ...modelDraft,
                          enabled: event.target.checked,
                        })
                      }
                    />
                    启用此模型
                  </label>
                  <div className="ws-row-actions">
                    <button
                      className="ws-button primary"
                      disabled={busy || running}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="ws-spin" />
                      ) : (
                        <Check size={15} />
                      )}
                      保存配置
                    </button>
                    {editingModelId && (
                      <button
                        type="button"
                        className="ws-button"
                        disabled={busy}
                        onClick={() => {
                          setEditingModelId(null);
                          setModelDraft({
                            ...blankModel,
                            ...(publicMode
                              ? {
                                  currency: "CNY" as const,
                                  dailyTokenLimit: 200000,
                                }
                              : {}),
                          });
                        }}
                      >
                        取消编辑
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </main>
          )}
          {tab === "account" && publicMode && (
            <main className="ws-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">ACCOUNT / 你的私人空间</p>
                  <h1>{health?.user?.username}，欢迎回来。</h1>
                  <p>
                    对话、命盘和记忆按账号独立保存。你可以导出自己的数据，随时删除不想留下的对话和记忆。
                  </p>
                </div>
                <UserRound className="ws-section-symbol" size={38} />
              </div>
              <div className="ws-account-layout">
                <section className="ws-account-summary">
                  <h2>我的使用情况</h2>
                  <dl>
                    <div>
                      <dt>今日已提交</dt>
                      <dd>{accountUsage?.usedToday ?? "—"} 次</dd>
                    </div>
                    <div>
                      <dt>每日上限</dt>
                      <dd>{accountUsage?.dailyRunLimit ?? "—"} 次</dd>
                    </div>
                    <div>
                      <dt>账号身份</dt>
                      <dd>{isAdmin ? "站点管理员" : "普通用户"}</dd>
                    </div>
                  </dl>
                  <p className="ws-muted">
                    每天按站点时区重置额度。失败或停止的提交也会记录，避免反复请求造成额外消耗。
                  </p>
                  <button
                    className="ws-button"
                    disabled={busy}
                    onClick={() => void exportData()}
                  >
                    <Download size={15} />
                    导出我的对话与记忆
                  </button>
                  <p className="ws-muted">
                    模型提出的记忆需要你确认后才生效。请避免保存不必要的敏感资料。
                  </p>
                </section>
                <PasswordForm
                  onError={report}
                  onSaved={() => {
                    setNotice("密码已更新，其他登录已退出。");
                    void checkHealth();
                  }}
                />
              </div>
            </main>
          )}
          {tab === "site" && publicMode && isAdmin && (
            <main className="ws-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">SITE / 管理这间观星室</p>
                  <h1>开放有度，使用有数。</h1>
                  <p>
                    决定是否接受新用户，为每个账号设置每日解读额度。模型与全站费用上限在“模型”中管理。
                  </p>
                </div>
                <ShieldCheck className="ws-section-symbol" size={38} />
              </div>
              <div className="ws-site-layout">
                <form className="ws-site-form" onSubmit={saveSite}>
                  <h2>访问与额度</h2>
                  {siteSettings ? (
                    <>
                      <label className="ws-checkbox">
                        <input
                          type="checkbox"
                          checked={siteSettings.registrationOpen}
                          onChange={(event) =>
                            setSiteSettings({
                              ...siteSettings,
                              registrationOpen: event.target.checked,
                            })
                          }
                        />
                        开放新用户注册
                      </label>
                      <p className="ws-muted">
                        关闭注册后，已有用户仍可登录。需要暂停某个账号时，可在右侧停用。
                      </p>
                      <label>
                        每位用户每日最多提交次数
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          required
                          value={siteSettings.dailyRunLimit}
                          onChange={(event) =>
                            setSiteSettings({
                              ...siteSettings,
                              dailyRunLimit: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <p className="ws-muted">
                        额度包含已提交任务。建议小范围试用时从每天 10 次开始。
                      </p>
                      <button className="ws-button primary" disabled={busy}>
                        <Check size={15} />
                        保存站点设置
                      </button>
                    </>
                  ) : (
                    <p className="ws-muted">正在读取站点设置…</p>
                  )}
                </form>
                <section className="ws-user-list">
                  <div className="ws-ledger-heading">
                    <h2>
                      用户 <span>{users.length}</span>
                    </h2>
                    <p>停用和重置密码会退出该用户的旧登录。</p>
                  </div>
                  {users.map((user) => (
                    <AccountRow
                      key={user.id}
                      user={user}
                      selfId={health?.user?.id}
                      onError={report}
                      onChange={async () => {
                        const response = await api.users();
                        setUsers(response.users);
                        setNotice("用户设置已更新。");
                      }}
                    />
                  ))}
                </section>
              </div>
            </main>
          )}
          {tab === "usage" && (
            <main className="ws-panel ws-usage-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">USAGE / 每一次调用都有据可查</p>
                  <h1>
                    {publicMode && isAdmin
                      ? "站点用量，一目了然。"
                      : "用量与我的数据。"}
                  </h1>
                  <p>
                    账本记录请求、估算与额度预留。工具循环中的各次调用分别计入，失败或中断记录也会保留。
                  </p>
                </div>
                <button
                  className="ws-button"
                  disabled={busy}
                  onClick={() => void exportData()}
                >
                  <Download size={15} />
                  导出我的数据
                </button>
              </div>
              {dashboard ? (
                <>
                  <dl className="ws-usage-overview">
                    <div>
                      <dt>今日记账 tokens</dt>
                      <dd>{number(dashboard.today.totalTokens)}</dd>
                      <small>
                        输入 {number(dashboard.today.inputTokens)} / 输出{" "}
                        {number(dashboard.today.outputTokens)}
                        <br />
                        包含服务商值、估算及额度预留
                      </small>
                    </div>
                    <div>
                      <dt>{publicMode && isAdmin ? "站点记录" : "我的记录"}</dt>
                      <dd>
                        {number(dashboard.sessions)} <small>对话</small> ·{" "}
                        {number(dashboard.memories)} <small>记忆</small>
                      </dd>
                      <small>{number(dashboard.runs)} 次运行</small>
                    </div>
                    <div>
                      <dt>今日估算费用 · 分币种</dt>
                      <dd className="ws-currency-totals">
                        {dashboard.costs.length ? (
                          dashboard.costs.map((cost) => (
                            <span key={cost.currency}>
                              {cost.amount === 0
                                ? `${cost.currency} 暂无已计价费用`
                                : money(cost.amount, cost.currency)}
                            </span>
                          ))
                        ) : (
                          <span>暂无已计价费用</span>
                        )}
                      </dd>
                      <small>
                        按配置价格估算，含预留；非服务商账单，0 不代表免费
                      </small>
                    </div>
                  </dl>
                  <div className="ws-ledger-heading">
                    <h2>
                      调用账本 <span>{dashboard.usage.length} 条</span>
                    </h2>
                    <p>
                      预留额度用于保守记账，尚未核实；0 或缺失不代表零消耗。
                    </p>
                  </div>
                  {dashboard.usage.length ? (
                    <div
                      className="ws-table-scroll"
                      tabIndex={0}
                      aria-label="调用账本，可横向滚动"
                    >
                      <table>
                        <thead>
                          <tr>
                            <th>时间 / 请求</th>
                            <th>模型</th>
                            <th>输入</th>
                            <th>输出</th>
                            <th>费用估算</th>
                            <th>用量来源</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.usage.map((usage) => (
                            <tr key={usage.id}>
                              <td>
                                <time>{time(usage.createdAt)}</time>
                                <small title={usage.runId}>
                                  {usage.runId.slice(0, 8)}
                                </small>
                              </td>
                              <td>{usage.modelName}</td>
                              <td>
                                {ledgerTokens(
                                  usage.inputTokens,
                                  usage.usageSource,
                                )}
                              </td>
                              <td>
                                {ledgerTokens(
                                  usage.outputTokens,
                                  usage.usageSource,
                                )}
                              </td>
                              <td>
                                {ledgerCost(
                                  usage.estimatedCost,
                                  usage.currency,
                                  usage.usageSource,
                                )}
                              </td>
                              <td>
                                <span
                                  className={
                                    usage.usageSource === "provider"
                                      ? "ws-active"
                                      : "ws-pending"
                                  }
                                >
                                  {sourceLabels[usage.usageSource]}
                                </span>
                              </td>
                              <td>
                                {statusLabels[usage.status] || usage.status}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="ws-empty-state">
                      还没有模型请求。发起一次对话后，这里会出现请求及额度预留记录。
                    </div>
                  )}
                </>
              ) : (
                <p className="ws-empty-state">
                  用量尚未读取成功。请使用顶部刷新按钮重试。
                </p>
              )}
            </main>
          )}
        </>
      )}
      {deleteTarget && (
        <DeleteConfirmation
          target={deleteTarget}
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget.kind === "session")
              void removeSession(deleteTarget.item);
            else void removeModel(deleteTarget.item);
          }}
        />
      )}
      <footer className="ws-footer">
        <span>观星 · 管理后台 / 模型、用量与站点设置</span>
        <span>传统文化与自我观察，不是科学预测。</span>
      </footer>
    </div>
  );
}
