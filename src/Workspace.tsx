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
} from "./workspace-api";
import "./workspace.css";

type Tab = "chat" | "memories" | "models" | "usage";
type Gate = "loading" | "unavailable" | "setup" | "login" | "ready";
const tabs: Array<{ id: Tab; title: string; icon: typeof MessageSquare }> = [
  { id: "chat", title: "对话", icon: MessageSquare },
  { id: "memories", title: "记忆", icon: Bookmark },
  { id: "models", title: "模型", icon: Cpu },
  { id: "usage", title: "用量", icon: Activity },
];
const sourceLabels: Record<UsageSource, string> = {
  provider: "服务商返回",
  estimate: "估算用量",
  unknown: "待核实 / 预留",
};
const statusLabels: Record<string, string> = {
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
        <span>{memory.sessionId ? "会话记忆" : "全局记忆"}</span>
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

export default function Workspace({
  initialTab,
  birth,
  onExit,
}: {
  initialTab: "agent" | "admin";
  birth?: ChartInput;
  onExit: () => void;
}) {
  const [gate, setGate] = useState<Gate>("loading");
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
  const [attachBirth, setAttachBirth] = useState(false);
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
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
  const messageEnd = useRef<HTMLDivElement>(null);
  const currentModel = models.find((model) => model.id === modelId);
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
      setGate("login");
      setDeleteTarget(null);
      setApiKey("");
      setDetail(null);
      setDashboard(null);
      setSessions([]);
      setModels([]);
      setMemories([]);
    }
    setError(messageFor(error));
  }
  async function loadAll() {
    const [sessionData, modelData, memoryData, usageData] = await Promise.all([
      api.sessions(),
      api.models(),
      api.memories(),
      api.usage(),
    ]);
    if (!alive.current) return;
    setSessions(sessionData.sessions);
    setModels(modelData.models);
    setMemories(memoryData.memories);
    setDashboard(usageData);
    setModelId((current) =>
      modelData.models.some((model) => model.id === current && model.enabled)
        ? current
        : modelData.models.find((model) => model.enabled)?.id || "",
    );
  }
  async function checkHealth() {
    setGate("loading");
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const health = await api.health(controller.signal);
      if (!health.ok || typeof health.needsSetup !== "boolean")
        throw new Error("服务状态不完整。");
      if (!alive.current) return;
      setGate(
        health.needsSetup ? "setup" : health.authenticated ? "ready" : "login",
      );
      if (health.authenticated && !health.needsSetup) {
        try {
          await loadAll();
        } catch (error) {
          report(error);
        }
      }
    } catch (error) {
      if (alive.current) {
        setGate("unavailable");
        setError(
          controller.signal.aborted
            ? "本地服务响应超时。请确认服务与数据库已经启动，再重新连接。"
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
    if (!sessionId || gate !== "ready") return;
    const controller = new AbortController();
    setDetailLoading(true);
    api
      .session(sessionId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && selectedId.current === sessionId)
          setDetail(data);
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

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (
      gate === "setup" &&
      (password.length < 12 || password !== confirmation)
    ) {
      setError(
        password.length < 12
          ? "首次密码至少需要 12 个字符。"
          : "两次输入的密码不一致。",
      );
      return;
    }
    setBusy(true);
    try {
      await (gate === "setup" ? api.setup(password) : api.login(password));
      setPassword("");
      setConfirmation("");
      setGate("ready");
      await loadAll();
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
      setNotice("已刷新本地数据。");
    } catch (error) {
      report(error);
    } finally {
      setRefreshing(false);
    }
  }
  function chooseSession(id: string) {
    selectedId.current = id;
    setSessionId(id);
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
    if (!prompt.trim() || !currentModel?.enabled || !apiKey.trim() || running)
      return;
    const content = prompt.trim();
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
          "已停止等待并通知服务端取消运行。正在执行的调用可能已经产生用量，请查看账本。",
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
      if (alive.current) setRunning(false);
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
      setModelDraft({ ...blankModel });
      setApiKey("");
      await loadAll();
      setNotice("模型配置已保存。Key 不在配置中。");
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
        setModelDraft({ ...blankModel });
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
      setNotice("已导出本地数据。文件包含会话与记忆，请妥善保存。");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    runController.current?.abort();
    setBusy(true);
    setError("");
    try {
      await api.logout();
      setApiKey("");
      setPassword("");
      setDetail(null);
      setSessionId(null);
      selectedId.current = null;
      setSessions([]);
      setModels([]);
      setMemories([]);
      setDashboard(null);
      setLastRun(null);
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
    <div className="ws-shell">
      <header className="ws-header">
        <button className="ws-back" aria-label="返回星图" onClick={exit}>
          <ArrowLeft size={17} />
          <span>返回星图</span>
        </button>
        <div className="ws-brand">
          观星 <span>WORKSPACE</span>
        </div>
        <span className="ws-local">
          <i />
          本地工作台
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
          <p className="ws-eyebrow">YOUR OWN SPACE / 你的私人观星室</p>
          {gate === "loading" ? (
            <>
              <LoaderCircle className="ws-spin" size={26} />
              <h1>连接本地工作台</h1>
              <p>正在确认服务与登录状态。</p>
            </>
          ) : gate === "unavailable" ? (
            <>
              <h1>
                把这间观星室，
                <br />
                留在你自己的电脑里。
              </h1>
              <p>
                公开站点提供星图体验。连续对话、记忆、模型管理与真实用量需要本地服务和
                PostgreSQL + pgvector。
              </p>
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
              <p className="ws-muted">
                首次打开后创建至少 12
                位的管理员密码。页面不会模拟已保存的记忆或后台数据。
              </p>
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
                {gate === "setup" ? "开启你的观星室。" : "回到你的观星室。"}
              </h1>
              <p>
                {gate === "setup"
                  ? "创建本地管理员密码。你的会话与确认的记忆将保存在自己的 PostgreSQL 数据库中。"
                  : "使用本地管理员密码登录，继续上一次对话。"}
              </p>
              <form className="ws-auth" onSubmit={authenticate}>
                <label>
                  管理员密码
                  <input
                    type="password"
                    autoComplete={
                      gate === "setup" ? "new-password" : "current-password"
                    }
                    required
                    minLength={gate === "setup" ? 12 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      gate === "setup" ? "至少 12 个字符" : "输入你的密码"
                    }
                  />
                </label>
                {gate === "setup" && (
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
                  {gate === "setup" ? "创建并进入" : "进入工作台"}
                </button>
              </form>
            </>
          )}
        </main>
      ) : (
        <>
          <nav className="ws-tabs" aria-label="工作台功能">
            {tabs.map((item) => (
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
              aria-label="刷新工作台"
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
                    disabled={busy || running}
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
                          disabled={running}
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
                        ? `已附命盘 · ${detail.session.birth.date} · 出生信息保存在本地数据库`
                        : "连续对话 · 由你确认记忆 · 工具操作可追溯"}
                    </p>
                  </div>
                  {running && (
                    <span className="ws-running">
                      <LoaderCircle size={14} className="ws-spin" />
                      正在思考
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
                        理解自己，
                        <br />
                        可以慢慢来。
                      </h2>
                      <p>
                        谈谈最近困扰你的事。Agent
                        可以查看附带的命盘、检索你确认过的记忆，再提出具体的观察角度。
                      </p>
                      <div className="ws-starters">
                        {[
                          "我最近总在工作和休息之间拉扯，想梳理一下。",
                          "请根据附带的命盘，帮我整理三个自我观察的问题。",
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
                        正在执行本次请求。完成后显示实际工具记录与用量；你可以随时停止。
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
                          .filter((model) => model.enabled)
                          .map((model) => (
                            <option value={model.id} key={model.id}>
                              {model.name}
                            </option>
                          ))}
                      </select>
                    </label>
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
                  </div>
                  {!models.some((model) => model.enabled) && (
                    <button
                      type="button"
                      className="ws-action gold"
                      onClick={() => setTab("models")}
                    >
                      先配置一个模型服务 ↗
                    </button>
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
                      Key
                      经本机后端转发到所选服务，不保存。会话与确认的记忆保存在本地。
                    </p>
                    {running ? (
                      <button
                        type="button"
                        className="ws-button"
                        onClick={() => runController.current?.abort()}
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
                          !apiKey.trim() ||
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
          {tab === "models" && (
            <main className="ws-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">MODELS / 选择自己的模型</p>
                  <h1>服务、价格、限额。</h1>
                  <p>
                    保存可复用的模型配置。API Key
                    在每次对话时临时输入，不写入配置或数据库。
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
                            const { id, ...draft } = model;
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
                    限额 0 表示不限；价格 0
                    表示未计价，不代表免费。估算费用用于个人控制，不是服务商账单。
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
                          setModelDraft({ ...blankModel });
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
          {tab === "usage" && (
            <main className="ws-panel ws-usage-panel">
              <div className="ws-section-heading">
                <div>
                  <p className="ws-eyebrow">USAGE / 每一次调用都有据可查</p>
                  <h1>用量与本地数据。</h1>
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
                  导出全部数据
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
                      <dt>本地记录</dt>
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
        <span>观星 · 紫微 / 私有的自我观察空间</span>
        <span>传统文化与自我观察，不是科学预测。</span>
      </footer>
    </div>
  );
}
