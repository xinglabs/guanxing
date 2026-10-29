# 观星 · 紫微

**从一张星图，开始一段有记忆的对话。**

Guanxing V3 是 XINGLABS 的开源紫微斗数应用。全屏动态星景与真实排盘之外，完整版本提供多轮 Agent 对话、可确认的长期记忆、模型管理和用量后台。可以在本机使用，也可以部署为独立网页：每位用户拥有自己的会话和记忆，管理员统一管理模型与额度。

[公开体验](https://xinglabs.github.io/guanxing/) · [XINGLABS](https://xinglabs.github.io/) · [本地部署](docs/local-deployment.md) · [服务器部署](docs/server-deployment.md) · [Agent 架构](docs/agent-architecture.md)

![观星桌面预览](docs/preview-desktop.png)

## 运行方式

|                              | 公开静态版                                 | Docker 本地完整版本                                                    |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 全屏动态界面、真实十二宫排盘 | 支持                                       | 支持                                                                   |
| 单次 AI 解读                 | 访客临时填写自己的 Key，浏览器直接请求服务 | 支持                                                                   |
| 多轮 Agent 与受限工具循环    | 提示启动本地版                             | 支持                                                                   |
| 会话、记忆、模型与用量后台   | 无业务数据库                               | PostgreSQL 持久化                                                      |
| 长期记忆                     | 无                                         | 用户确认后生效，可编辑、删除                                           |
| 向量数据                     | 无                                         | pgvector 已接入；尚未配置 embedding provider，当前按文本和近期记忆检索 |

GitHub Pages 发布的是静态页面，不能承载 API 或数据库。Docker 本地版默认只对本机开放。新增的**独立网页服务器版**提供用户名登录、用户数据隔离、后台任务、注册开关和每日次数限制；模型 Key 由管理员在页面配置并加密保存。收费和打赏尚未接入。

## 部署独立网页端

已安装 Docker 与 Compose 的 Linux 服务器，优先下载 [Release 的 Linux amd64 离线部署包](https://github.com/xinglabs/guanxing/releases)，校验并解压后执行：

```bash
./scripts/install-offline.sh
```

离线包包含应用、数据库和 HTTPS 代理镜像，安装时不必登录或连接镜像仓库。若选择 Git 克隆并在线拉镜像，使用 `./scripts/start-server.sh`。两者都会生成私密配置，并只监听服务器 loopback。先通过 SSH 隧道完成管理员初始化；域名准备好后使用 `--domain 你的域名` 开启 HTTPS。脚本不会重装系统或安装本地模型。

完整的阿里云 Linux 3 操作步骤、初始化令牌、域名、更新、备份及国内镜像下载失败的处理，见 [服务器部署指南](docs/server-deployment.md)。

## 启动本地完整版本

准备并启动 Docker Desktop，克隆仓库后运行：

```bash
git clone https://github.com/xinglabs/guanxing.git
cd guanxing
./scripts/start-local.sh
```

脚本构建并启动应用与 PostgreSQL/pgvector，自动生成本地数据库密码，不在终端打印。健康检查通过后打开 [Agent 工作区](http://127.0.0.1:3000/#agent)。不需要预先配置模型，也不会下载任何模型。

首次进入时在页面设置管理员密码。之后可以创建会话、整理记忆和查看后台；需要实际模型回复时，再到页面配置模型服务、模型名和临时 API Key。完整说明、端口修改、镜像覆盖与备份见 [本地部署](docs/local-deployment.md)。

## 本地 Agent 能做什么

- **真实命盘作为工具**：把当前命盘附到会话，Agent 通过 `get_chart` 读取确定性排盘数据，不自行编造星曜。
- **多轮对话**：保留会话历史，通过有界的“请求模型 → 执行工具 → 再请求模型”循环回答问题。
- **长期记忆**：`search_memory` 查找已确认信息；`propose_memory` 只提出候选，必须由用户确认才生效。记忆可以编辑或删除。
- **模型后台**：管理兼容服务地址、模型、启用状态、输入/输出价格、每日 token 和费用预算。
- **用量账本**：记录每一次模型调用，包括工具循环中的多次请求；区分服务商返回、估算和未知来源，不同币种分别汇总。
- **本地数据管理**：首次设置管理员、登录、删除会话、导出业务数据；数据库使用具名 Docker 卷保留。

每次运行最多 5 步，每步最多 4 次工具调用，单次运行最多提出 3 条候选记忆，运行超时为 120 秒。仅提供命盘和记忆相关工具，没有 Shell、浏览器或任意 SQL 执行工具。

当前 embedding 适配器明确返回“未配置”。pgvector 的 768 维存储和检索路径已接入，但默认运行不会产生向量，也不把文本匹配称作语义检索。以后可在独立的适配边界接入 embedding API，无需改变记忆管理流程。

## API Key 与数据

**静态版和本地版：** 访客临时填写的 Key 仅在当前页面和本次后端请求的内存中使用，不写入持久存储，刷新后需要重新输入。

**独立网页服务器版：** 管理员配置的模型 Key 使用服务器 `APP_SECRET` 加密后存入数据库，普通用户不需要填 Key，也不能读取它。请妥善保管 `.env.server` 和数据库备份。

公开静态版由浏览器直接请求所选模型服务，服务需要允许 CORS。本地 Agent 由同源后端调用所选服务，并检查允许的目标主机；本地对话、记忆、附带命盘与用量保存到自己的 PostgreSQL。模型请求会包含本次问题及相关上下文，数据处理与收费由所选服务决定。项目本身不提供模型 Key 或 API 额度；服务器版的模型消耗由部署者在后台配置和承担。

完整数据流见 [隐私说明](docs/privacy.md)。

## 本机排盘

1. 输入公历出生日期、时辰和排盘使用的性别，或先打开示例。
2. 点选十二宫，查看主星、辅曜、亮度与四化。
3. 需要对话时进入本地 Agent 工作区，并选择是否附带当前命盘。

排盘无需 API Key。输入支持 1900—2100 年；选择的是地支时辰，不是 24 小时制钟点。使用上游默认的全书亮度表与闰月分半规则，不自动校正真太阳时、时区或夏令时。子时序号为 0；若采用晚子时换日口径，23 点出生请将排盘日期选为次日。

紫微斗数与生成文字用于传统文化学习、娱乐与自我观察，不是科学预测，也不应代替现实中的事实核实和判断。

## 开发与验证

技术栈：React、TypeScript、Vite、Node.js 22、PostgreSQL 17、pgvector。

```bash
npm ci
npm test
npm run build
```

`npm test` 中的 PostgreSQL 集成测试需要 `TEST_DATABASE_URL`，未设置时会明确跳过；该连接应指向可创建临时数据库的专用测试实例，不能当作普通生产连接使用。无需数据库的排盘、Agent 和隐私相关测试仍会运行。

只开发静态界面：

```bash
npm run dev
```

开发完整工作区时，另外准备 PostgreSQL/pgvector 并为服务端设置 `DATABASE_URL`，使用 `npm run server:dev` 启动 API。Vite 开发服务器将 `/api` 代理到本机服务。生产静态资源由 `npm run build` 生成，`npm start` 启动 Node 服务。推荐首先用 Docker 完成整套本地运行。

## 发布公开静态版

仓库包含 [Pages workflow](.github/workflows/pages.yml)。在 GitHub 的 **Settings → Pages → Source** 选择 **GitHub Actions**，推送到 `main` 后执行依赖安装、测试与构建，再发布 `dist/`。这项发布不包含 Node API、数据库、私有对话或本地 `.env`。

## 来源与设计

真实排盘引擎来自 [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)，保留 MIT 授权。未打包上游的非商业讲义语料或解释数据集。

Agent 的循环和职责划分参考 [DeepSeek 官方 Harness](https://github.com/deepseek-ai/deepseek-harness) 的一手文档。本项目独立实现 TypeScript 服务，没有 fork、安装或集成官方 `dsh` 运行时；具体参考与差异见 [Harness 参考说明](docs/harness-references.md)。

视觉参考 Lusion 的沉浸式场景，以及 Hallmark、Impeccable、AI Design Skills 的排版与交互思路。背景为项目原创，中文字体本地托管。详见 [设计说明](docs/design.md)、[素材来源](docs/assets.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。

## License

新编写代码采用 [MIT License](LICENSE)。上游文件、字体与依赖保留各自的版权和授权，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
