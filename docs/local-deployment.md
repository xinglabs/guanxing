# 本地运行观星

完整工作区由浏览器、Node.js 服务、PostgreSQL 和 pgvector 组成。聊天、确认后的记忆、模型配置及用量账本保存在本机 Docker 数据卷。GitHub Pages 只提供静态体验，不能运行这些后端功能。

## 一条命令启动

准备 Docker Desktop（或 Docker Engine + Compose v2），启动 Docker 后，在项目目录执行：

```bash
./scripts/start-local.sh
```

脚本会创建本地 `.env`，生成随机数据库密码且不在终端打印，然后构建前端和服务端、启动数据库、等待应用可用，最后打开 [Agent 工作区](http://127.0.0.1:3000/#agent)。不想自动打开浏览器时加 `--no-open`。

第一次进入工作区时，在页面设置至少 12 位的管理员密码。数据库密码由部署使用，管理员密码用于工作区登录，两者独立。模型 API Key 在对话区临时输入，无需写进 `.env`。

默认端口为 `3000`。已被占用时，将 `.env` 中的 `APP_PORT` 改为其他端口，再运行脚本。

## 首次使用

1. 进入 Agent 工作区并完成管理员设置。
2. 在“模型”里配置服务地址、模型名、是否启用，以及每百万输入/输出 token 的价格和每日预算。价格为自己填入的估算口径。
3. 新建对话，可选择附带当前命盘。选择模型并临时输入对应 Key，然后发送问题。
4. 在“记忆”里检查待确认条目，编辑后确认或删除。确认前的候选内容不作为已确认记忆使用。
5. 在“用量”里查看每次模型调用、累计 token、费用估算和来源标记。不同币种分别汇总。

只进行本机排盘不需要模型服务。模型解读仍需可用的兼容服务、网络和对应账户额度。

## 记忆与向量存储

默认只启动应用和数据库，不部署或下载任何模型。PostgreSQL 已启用 pgvector，记忆表使用 `vector(768)` 字段，存储和检索路径已接入，但 embedding provider 尚未配置，不会自动产生向量。

当前记忆检索使用文本匹配和近期已确认记忆。界面会显示 embedding 未配置，不能把这一路径称作语义检索。以后接入兼容的 embedding API 时，需要统一使用 768 维向量并对已有记忆重新索引；切换模型后不能混用旧向量。

聊天模型及 API Key 之后直接在页面配置即可，无需为了启动工作区先准备模型。

## 配置项

| 变量 | 默认值或用途 |
| --- | --- |
| `POSTGRES_PASSWORD` | 必填，由启动脚本自动生成；手工配置时使用 URL 安全字符，建议随机十六进制。 |
| `APP_PORT` | `3000`；只绑定本机 `127.0.0.1`。 |
| `NODE_IMAGE` | 构建用基础镜像，默认 `node:22-bookworm-slim`。 |
| `PGVECTOR_IMAGE` | 数据库镜像，默认 `pgvector/pgvector:pg17`。 |
| `MODEL_ALLOWED_HOSTS` | 允许的模型服务主机名，用逗号分隔；默认包含 DeepSeek、OpenAI、OpenRouter 以及本机地址。 |

接入自有模型网关时，先把其主机名加入 `MODEL_ALLOWED_HOSTS`，再重建应用容器。主机名不包含协议、端口或路径；模型界面中的服务地址仍需完整 URL。这个配置只允许连接目标，不保存认证密钥。

不使用 Docker 启动服务时，服务端额外读取 `DATABASE_URL`、`HOST`、`PORT`；容器中已配置为数据库服务地址、`0.0.0.0` 和 `3000`。宿主机只映射回环地址，数据库不暴露宿主机端口。Compose 会按 `APP_PORT` 自动设置允许的 `APP_ORIGIN`，使自定义本机端口可以通过 Host/Origin 检查。自行启动 API 时可用逗号分隔的 `APP_ORIGIN` 指定允许的页面来源。

## 使用已有的可信镜像

默认镜像保持官方来源。Docker Hub 无法访问或本机已缓存等价镜像时，可在 `.env` 指定 `NODE_IMAGE` 和 `PGVECTOR_IMAGE`，再运行启动脚本。Node 镜像须兼容 Node.js 22 / Debian bookworm；数据库镜像须提供 PostgreSQL 17 与 pgvector，并保持官方 PostgreSQL 的环境变量和数据目录约定。

例如，官方 Node 镜像也可以从 Docker Official Images 的公开 ECR 镜像源取得：

```dotenv
NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim
```

`PGVECTOR_IMAGE` 可以填入自己已验证来源的本机镜像标签。不要填入没有核对来源的镜像。镜像覆盖只改变容器来源，不改变应用功能或启用任何模型。数据库仍使用原具名卷，切换前应确认 PostgreSQL 主版本兼容。

## 停止、重启与升级

```bash
docker compose stop
docker compose start
```

更新源码后重新运行启动脚本，它会重新构建应用；数据库继续使用原数据卷。`docker compose down` 移除容器和网络但保留具名卷。不要删除数据卷，除非明确需要清空全部本地数据。

当前镜像基于 `node:22-bookworm-slim` 和 `pgvector/pgvector:pg17`。生产部署应按自己的升级流程固定并验证镜像 digest；此配置面向个人本机使用。

## 导出与备份

工作区的导出按钮提供 JSON 数据，不包含管理员密码散列、登录令牌和临时模型 Key。恢复完整数据库时，应使用 PostgreSQL 备份，而不是把导出文件直接当作数据库。

在项目目录创建本地数据库备份：

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U guanxing -d guanxing -Fc > backups/guanxing.dump
```

此文件包含个人对话和记忆，保存在自己的设备上，不提交到 GitHub。备份时可另行保存 `.env`，以便了解当前部署配置。

## 排查启动问题

```bash
docker compose ps
docker compose logs --tail=80 app
docker compose logs --tail=80 db
```

- Docker 不可用：启动 Docker Desktop，再执行脚本。
- 首次构建失败：检查 Docker 拉取镜像与 npm 安装所需的网络；再次运行脚本会复用已完成的构建层。
- 数据库认证失败：已有 PostgreSQL 数据卷不会因为修改 `.env` 自动改变数据库密码。恢复与数据卷对应的配置，或使用 PostgreSQL 的管理员流程修改密码；不要直接删除卷。
- 模型请求失败：检查服务地址、主机允许列表、模型名、Key 和服务商余额。临时 Key 不会因重启或刷新自动恢复。

数据库和 pgvector 可免费自托管；设备、存储和模型 API 的成本由各自运行环境决定。
