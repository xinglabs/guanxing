import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { workspaceApi as api, WorkspaceError } from "./workspace-api";
import type { AdminUsageReport, UsageTotals } from "./lib/admin-usage";

const number = (value: number) => value.toLocaleString("zh-CN");
function Costs({ costs }: { costs: UsageTotals["costs"] }) {
  return (
    <>
      {costs.length
        ? costs.map((c) => (
            <span key={c.currency} className="ws-report-cost">
              {c.currency}{" "}
              {c.amount.toLocaleString("zh-CN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              })}
            </span>
          ))
        : "—"}
    </>
  );
}

export default function AdminUsage({
  onError,
  refreshToken = 0,
}: {
  onError: (error: unknown) => void;
  refreshToken?: number;
}) {
  const [date, setDate] = useState("");
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<AdminUsageReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void api
      .adminUsage(date || undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setReport(data);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "暂时无法读取用量。");
        if (e instanceof WorkspaceError && e.status === 401) onError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [date, revision, refreshToken]);
  return (
    <main className="ws-panel ws-usage-panel" aria-busy={busy}>
      <div className="ws-section-heading">
        <div>
          <p className="ws-eyebrow">SITE USAGE / 系统管理员</p>
          <h1>每位用户，每一天。</h1>
          <p>
            查看用户消耗与全站总量。普通用户不展示模型、Token、费用或使用上限。
          </p>
        </div>
        <div className="ws-report-controls">
          <label>
            统计日期
            <input
              type="date"
              aria-label="统计日期"
              value={date || report?.date || ""}
              onInput={(e) => setDate(e.currentTarget.value)}
            />
          </label>
          <button
            className="ws-button"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={15} />
            刷新统计
          </button>
        </div>
      </div>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">正在读取全站用量…</p>
      ) : (
        !error &&
        report && (
          <>
            <p className="ws-muted">
              {report.date} · 按 {report.timezone}{" "}
              自然日统计；累计数据覆盖所有日期。
            </p>
            <dl className="ws-usage-overview">
              <div>
                <dt>当日全站 Token</dt>
                <dd>{number(report.daily.totalTokens)}</dd>
                <small>
                  输入 {number(report.daily.inputTokens)} / 输出{" "}
                  {number(report.daily.outputTokens)}
                  <br />
                  {number(report.daily.calls)} 次模型调用
                </small>
              </div>
              <div>
                <dt>当日全站估算费用</dt>
                <dd>
                  <Costs costs={report.daily.costs} />
                </dd>
                <small>
                  {number(report.daily.unverifiedCalls)}{" "}
                  次调用使用估算或预留用量
                </small>
              </div>
              <div>
                <dt>全站累计消耗</dt>
                <dd>
                  {number(report.allTime.totalTokens)} <small>Token</small>
                </dd>
                <small>
                  {number(report.allTime.calls)} 次模型调用
                  <br />
                  <Costs costs={report.allTime.costs} />
                </small>
              </div>
            </dl>
            <div className="ws-ledger-heading">
              <h2>
                用户每日消耗 <span>{report.users.length} 个账号</span>
              </h2>
              <p>
                一次提问可能调用模型多次；失败、停止与未核实的预留也计入消耗。
              </p>
            </div>
            <div
              className="ws-table-scroll"
              tabIndex={0}
              aria-label="用户每日消耗，可横向滚动"
            >
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>提问次数</th>
                    <th>模型调用</th>
                    <th>输入 Token</th>
                    <th>输出 Token</th>
                    <th>总 Token</th>
                    <th>估算费用</th>
                  </tr>
                </thead>
                <tbody>
                  {report.users.map((user) => (
                    <tr key={user.userId}>
                      <td>
                        <strong>{user.username}</strong>
                        <small>
                          {user.role === "admin" ? "系统管理员" : "普通用户"}
                          {user.disabled ? " · 已停用" : ""}
                        </small>
                      </td>
                      <td>{number(user.requests)}</td>
                      <td>
                        {number(user.calls)}
                        {user.unverifiedCalls > 0 && (
                          <small>{user.unverifiedCalls} 次估算 / 预留</small>
                        )}
                      </td>
                      <td>{number(user.inputTokens)}</td>
                      <td>{number(user.outputTokens)}</td>
                      <td>{number(user.totalTokens)}</td>
                      <td>
                        <Costs costs={user.costs} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ws-muted">
              费用按管理员配置的价格估算，分币种统计，不等同于服务商账单。未计价或未产生账本显示“—”，不代表服务免费。
            </p>
          </>
        )
      )}
    </main>
  );
}
