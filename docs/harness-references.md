# Agent Harness 参考与边界

核对日期：2026-10-28。主要参考是 [DeepSeek 官方 `deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，核对版本 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`，分支 `master`。该项目的 README 将其标为 developer preview，提示接口仍可能出现不兼容变化。

观星没有安装 `@deepseek-ai/dsh`、没有 fork 官方 Harness，也没有把官方运行时或插件代码复制进来。当前 Agent 服务是本项目独立编写的 TypeScript 实现；以下资料用于理解循环、工具、会话和记忆的职责边界。

## 官方资料确认了什么

| 来源 | 已核对的机制 | 在观星中的取舍 |
| --- | --- | --- |
| [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/architecture.md) | Cordis 插件贡献服务、类型化事件和可撤销效果；模型适配器、工具注册、会话日志、Agent 循环都可由配置替换。 | 将模型调用、工具执行和存储分开实现，保持接口清楚；没有引入 Cordis 插件体系。 |
| [Agent-loop](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/core/agent-loop/README.md) | 一个 step 包含模型请求及其工具调用；一个 turn 可以有多个 step，工具结果可触发下一次模型请求；取消和执行结算贯穿循环。 | 使用有次数、时间与预算约束的工具循环，而不是一次性把问题拼进 prompt；展示本次工具活动及调用用量。 |
| [Session log](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/architecture.md#session-log) | append-only SessionEvent 是模型上下文的来源，模型历史由日志投影；持久化事实和运行时事件分开。 | PostgreSQL 分别保存对话、运行和用量。当前数据库不是官方 SessionEvent 格式，也不声称完整实现其重放、分叉和恢复语义。 |
| [Third-party memory MCP guide](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/user/guide/mcp-memory.md) | 官方提供默认关闭的 Memorix、MCP Reference Memory、Engram 示例。DSH 负责 MCP 接入和工具发现；建库、模型、embedding 与数据迁移由记忆服务负责。示例不代表官方背书。 | 观星自己实现 PostgreSQL + pgvector 记忆，不依赖这三个服务，不把 MCP 接入描述成内置向量数据库。 |
| [Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/subsystems/compaction.md) | 上下文压缩是独立可选能力；摘要与压缩过程有记录，替换范围要保持工具调用和结果配对。 | 观星当前限定送入模型的历史与检索内容；这不等同于官方完整的自动压缩与溢出恢复机制。 |

## 记忆与上下文不是同一件事

对话历史记录一段交流。长期记忆是用户希望之后继续使用的事实或偏好。向量是帮助寻找相关记忆的检索表示，不能证明一条内容是真的。观星因此将模型提出的记忆先标为 `pending`，经用户确认后成为 `active`；内容被编辑后旧向量失效，需要重新索引。

官方文档里的 MCP Reference Memory 使用不区分大小写的子串匹配，并不自带 embedding、自动总结或遗忘策略。观星实现了自己的 `vector(768)` 存储和检索路径，并保留 embedding API 扩展边界；默认未配置 embedding，实际使用文本/近期记忆检索。这项存储实现独立于官方 Harness。

## 当前不包含的官方能力

观星没有实现通用插件市场、任意 Shell/浏览器工具、分布式 Agent Teams、代码沙箱、官方审批流水线或官方 SDK。它服务于单人的本地命盘探索与对话工作区。以后若接入 `dsh`，需要按当时的官方版本重新核对适配、配置与许可，不能仅因架构参考就宣称已经集成。
