# 独立网页端部署：阿里云 ECS

适用于 Alibaba Cloud Linux 3、x86_64、2 核 / 2 GiB 的服务器。Docker 已安装时可以直接继续，不需要重装系统。此配置运行网页、Node API 和 PostgreSQL/pgvector，不下载或运行本地模型，也不包含支付或打赏。

服务器版使用独立的 `compose.server.yaml`、`.env.server` 和 `guanxing-server_pgdata` 数据卷。原有 `compose.yaml` 本地版及其数据卷不会被替换。

## 1. 检查 Docker 和 Compose

在阿里云 Workbench 终端执行：

```bash
docker version
docker compose version
```

若仅第二条提示找不到 Compose，在 Alibaba Cloud Linux 3 上安装插件：

```bash
sudo dnf install -y docker-compose-plugin
```

若提示没有对应软件包，按 [阿里云官方安装文档](https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker) 中 **“安装 Docker Compose 失败 → Alibaba Cloud Linux 3”** 配置软件源和 `dnf-plugin-releasever-adapter` 后重试。已有正常工作的 Docker 不需要卸载，也不要删除 `/var/lib/docker`。

服务器约有 1.5 GiB 可用内存、28 GiB 可用磁盘时，可以先运行这套低并发配置。Compose 为应用和数据库分别设置 512 MiB 上限、为 HTTPS 代理设置 128 MiB 上限，并限制日志体积。健康检查和空闲占用不等于并发能力，公开注册前应以实际模型做小规模测试。

## 2. 下载并启动

优先使用 [GitHub Releases](https://github.com/xinglabs/guanxing/releases) 中已经发布的 **Linux amd64 离线部署包**。它包含网页服务、PostgreSQL/pgvector、Caddy 的镜像和部署脚本，不需要登录 GitHub，也不需要服务器连接 GHCR 或 Docker Hub 拉取镜像。首次下载仍需要能访问 GitHub；调用模型和申请 HTTPS 证书仍需要网络。

以 `v3.2.1` 为例，在首次部署的服务器终端执行（已有 `/opt/guanxing` 时先看第 5 节更新步骤）：

```bash
cd /opt
curl -fLO https://github.com/xinglabs/guanxing/releases/download/v3.2.1/guanxing-v3.2.1-linux-amd64.tar.gz
curl -fLO https://github.com/xinglabs/guanxing/releases/download/v3.2.1/guanxing-v3.2.1-linux-amd64.tar.gz.sha256
sha256sum -c guanxing-v3.2.1-linux-amd64.tar.gz.sha256
mkdir guanxing
tar -xzf guanxing-v3.2.1-linux-amd64.tar.gz --strip-components=1 -C guanxing
cd guanxing
./scripts/install-offline.sh
```

**只有 SHA256 校验显示 `OK` 才继续解压。** 安装脚本还会检查内部镜像校验和、验证 amd64 架构，再导入三套镜像并禁止拉取远程镜像。若 Release 尚未发布或下载返回 404，先确认发布页面，不能把错误页面当作压缩包使用。

若服务器无法访问 GitHub，可在自己电脑从同一 Release 下载 `.tar.gz` 和 `.tar.gz.sha256` 两个文件，上传到 `/opt` 后从校验步骤继续：

```bash
scp guanxing-v3.2.1-linux-amd64.tar.gz guanxing-v3.2.1-linux-amd64.tar.gz.sha256 root@YOUR_SERVER_IP:/opt/
```

若你更习惯 Git，并且服务器可访问 GHCR 与 Docker Hub，也可以选择源码目录安装：

```bash
sudo dnf install -y git
cd /opt
git clone https://github.com/xinglabs/guanxing.git
cd guanxing
./scripts/start-server.sh
```

首次启动自动生成数据库密码、模型 Key 加密密钥、初始化令牌，写入权限为 `600` 的 `.env.server`；不会在启动日志里打印这些值。再次运行复用原值，不会重置账号或数据库。

源码方式默认拉取预构建镜像 `ghcr.io/xinglabs/guanxing:latest`；离线包则使用包内固定版本的 `guanxing-web:v3.2.1`。两种方式都减少了在 2 GiB 服务器上安装依赖和编译的峰值内存。数据库使用 `pgvector/pgvector:pg17`，不安装任何本地模型。

**此时服务只监听服务器的 `127.0.0.1:3000`。** 不要为 3000 或 5432 开放公网安全组端口。没有域名也可以通过下一步的 SSH 隧道安全使用。

如果提示 3000 端口占用，先用 `ss -lntp` 确认已有服务，不要结束不明进程。所有检查命令都应在项目目录中执行。

## 3. 在自己的电脑打开，初始化管理员

在自己的电脑终端运行（把 `YOUR_SERVER_IP` 换成 ECS 公网 IP）：

```bash
ssh -N -L 3080:127.0.0.1:3000 root@YOUR_SERVER_IP
```

使用服务器已有的 SSH 登录方式。密码在 SSH 提示里输入，不要写进命令，也不要发到聊天里。阿里云安全组的 SSH 端口应允许自己电脑当前的公网 IP。若已有非 root 运维账号，把 `root` 换成该账号。

保持这个终端开着，在电脑浏览器访问：

```text
http://127.0.0.1:3080/#agent
```

这个 `localhost` 地址通过加密 SSH 连接转发到服务器，不是公开的明文登录页。电脑原有的本地观星服务可以继续占用 3000，隧道使用 3080。

在**服务器自己的可信终端**执行：

```bash
cd /opt/guanxing
./scripts/server-setup-token.sh
```

把显示的初始化令牌填到网页初始化表单，再设置管理员用户名和密码。令牌只用于首次创建管理员，之后普通登录使用用户名和密码。脚本拒绝向非交互日志输出令牌；不要把终端里显示的令牌截图或粘贴到公开位置。

进入管理后台后：

1. 创建模型配置，填写兼容 API 地址和准确模型名。
2. 在该模型的 Key 设置处填写密钥。服务器加密保存，不回显完整值；普通用户不会接触它。
3. 配置模型每日 token / 费用上限以及用户每日次数。单价需按服务商当前计价填写，后台估算不替代服务商账单。
4. 先用管理员账号完成一次小规模验证，再按需要开启注册。注册默认关闭。

聊天、记忆和任务归各自账号所有。默认排队执行模型任务，网页关闭后任务继续；刷新可以查看已完成结果。记忆候选仍需用户确认。pgvector 已安装，embedding 服务尚未配置时仍使用文本与近期记忆检索。

## 4. 有域名后开放 HTTPS

如果先自己使用，到第 3 步即可。有域名、准备公开网页后再做以下步骤。

1. 将域名的 A 记录解析到 ECS 公网 IP。仅在配置好 IPv6 时添加 AAAA 记录。
2. 中国内地服务器绑定域名提供网站服务前，完成适用的备案流程，详见 [阿里云 ICP 备案说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing)。
3. 阿里云安全组允许 TCP 80、443 入站。SSH 继续仅允许自己的管理来源；不开放数据库端口或 3000。
4. 在项目目录执行（替换为自己的真实域名）：

```bash
./scripts/start-server.sh --domain guanxing.example.com
```

脚本保存域名、更新应用允许来源并启动 Caddy。Caddy 在 DNS 和 80/443 可达时自动申请 HTTPS 证书、将 HTTP 跳转至 HTTPS。访问 `https://你的域名/#agent`。证书首次签发需要时间，应用就绪不表示公网证书已签发成功。

[Caddy 官方地址与自动 HTTPS 说明](https://caddyserver.com/docs/caddyfile/concepts)。应用入口只通过代理公开，代理保留 Host 并覆写真实来源 IP；不要再把 app 容器端口改为 `0.0.0.0`。

隧道来源仍然有效，可保留作管理和故障排查。若要暂时回到仅隧道访问：

```bash
./scripts/start-server.sh --domain ''
```

这会停止该项目的 HTTPS 代理，不删除证书或数据库卷。

## 5. 状态、更新和固定版本

```bash
./scripts/server-status.sh
```

查看容器健康状态和应用版本。排查启动失败时，可以在服务器查看最近日志，但分享日志前应去掉账号、问题内容、模型地址中的敏感信息：

```bash
docker compose --env-file .env.server -f compose.server.yaml logs --tail=100 app db
```

更新前先备份，并记录当前镜像：

```bash
./scripts/backup-server.sh
./scripts/server-status.sh
```

**离线包安装的更新方式：** 下载新版本的 `.tar.gz` 和 `.tar.gz.sha256`，校验通过后将包内文件解压到原来的 `/opt/guanxing`，再执行 `./scripts/install-offline.sh`。新包只含版本源码和镜像，不含 `.env.server` 或用户数据；安装器会保留原数据库密码与加密密钥，继续使用相同的 `guanxing-server` 数据卷。保留备份和上一版本包，升级后验证登录、历史记录和一次模型任务。离线包目录没有 Git 元数据，不使用 `git pull`。

**Git 源码安装的更新方式：**

```bash
git pull --ff-only
./scripts/start-server.sh --pull
```

如果发布说明要求固定到某个版本，使用已经发布的版本标签或镜像 digest：

```bash
./scripts/start-server.sh --image ghcr.io/xinglabs/guanxing:sha-已发布的完整提交SHA --pull
```

该值会保存进 `.env.server`。每次镜像发布都会输出 digest，并提供完整 `sha-` 标签。离线包的 `offline-manifest.env` 记录源码提交和应用镜像 digest；`offline-images.txt` 记录三套镜像信息。数据库迁移与程序版本需要匹配，不要在有数据迁移后盲目回滚到旧镜像；需要恢复时按对应版本的备份恢复到新环境。

不要执行 `docker compose down -v`，也不要随意更换 `.env.server` 里的数据库密码或 `APP_SECRET`。`APP_SECRET` 丢失后，数据库里的模型 Key 无法解密，需要重新录入；数据库本身并不因此丢失。

## 6. 备份和恢复

```bash
./scripts/backup-server.sh
```

生成权限为 `700` 的 `backups/server-时间-进程号/`，包括：

- `database.dump`：一致性 PostgreSQL 备份，含账号、会话、记忆和加密后的模型凭据。
- `server.env`：恢复所需的数据库密码和加密密钥，权限为 `600`。
- `images.json`：当时运行镜像的信息。

出现 `INCOMPLETE` 文件说明备份中途失败，不要用它恢复。把完整目录复制到服务器以外的受保护存储，限制访问；只在同一块系统盘上保留备份不能应对整机丢失。应用 Docker 日志有轮转，备份目录则由管理员定期整理。

**恢复建议在新服务器或新的空数据卷执行**，先确认目标没有需要保留的数据。以下不是日常启动命令：

```bash
# 在新环境的项目目录中，使用对应版本代码与镜像。
cp /受保护备份目录/server.env .env.server
chmod 600 .env.server
docker compose --env-file .env.server -f compose.server.yaml up -d db
# 等待数据库健康后再导入；目标数据库必须是空库。
docker compose --env-file .env.server -f compose.server.yaml exec -T db pg_restore -U guanxing -d guanxing --no-owner --exit-on-error < /受保护备份目录/database.dump
./scripts/start-server.sh
```

原备份带有域名时，恢复后会按它启动代理。在 DNS 切换前检查域名、端口和备份版本；需要仅隧道恢复时先运行 `./scripts/start-server.sh --init-only --domain ''`。

## 7. 镜像或 GitHub 下载失败

国内网络到 GitHub、GHCR、Docker Hub 的连通性因线路而异。脚本不会自动使用不明镜像站，也不会因为下载失败删除配置或数据。

- GitHub 下载失败：优先在自己电脑下载完整 Release 部署包及校验文件，再通过 SSH/SCP 上传，按第 2 节安装。
- GHCR 返回 `denied`：先确认项目的容器包已公开。仓库公开并不意味着新建 GHCR 包自动公开；首次发布需要仓库维护者设置 package visibility 并验证匿名拉取。[GitHub 官方说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- GHCR 不通但源码和基础镜像可用：`./scripts/start-server.sh --build` 在服务器构建。2 GiB 机器构建可能比运行时更吃内存，优先在 CI 或另一台电脑构建后传输。
- 基础镜像也下载失败：使用自己可访问网络的电脑准备 **linux/amd64** 镜像，再导出传输；仅导出 app 镜像不够，还需要 PostgreSQL，以及公开 HTTPS 时的 Caddy。

离线传输示例，在自己电脑的仓库目录：

```bash
docker buildx build --platform linux/amd64 -t guanxing-web:transfer --load .
docker pull --platform linux/amd64 pgvector/pgvector:pg17
docker pull --platform linux/amd64 caddy:2-alpine
docker save guanxing-web:transfer pgvector/pgvector:pg17 caddy:2-alpine | gzip > guanxing-images.tar.gz
scp guanxing-images.tar.gz root@YOUR_SERVER_IP:/opt/
```

在服务器加载后启动，不需要登录 GitHub：

```bash
gzip -dc /opt/guanxing-images.tar.gz | docker load
cd /opt/guanxing
./scripts/start-server.sh --no-pull --image guanxing-web:transfer
```

若使用已经批准、可访问的私有镜像仓库，可编辑 `.env.server` 的 `APP_IMAGE`、`PGVECTOR_IMAGE`、`CADDY_IMAGE`、`NODE_IMAGE`。文件采用未加引号的 `NAME=value` 格式，脚本不会把它当 Shell 执行。

## 发布与部署脚本验证

`.github/workflows/container.yml` 在测试通过后构建 Linux amd64 镜像并推送 GHCR。推送 `vX.Y.Z` 标签时，后续独立任务使用刚构建的镜像 digest，连同 pgvector、Caddy 和 `git archive` 跟踪源码生成离线包、内外 SHA256 校验和，并上传到对应 GitHub Release。不存在 Release 时创建草稿，维护者核验后再公开发布；已有 Release 则更新同名附件。打包脚本拒绝已跟踪的私密运行文件，不打包本机未跟踪的配置、数据和备份。

GitHub Pages 仍只发布静态前端；不会包含 `.env.server`、数据库或模型 Key。

```bash
node --test scripts/test-server-deployment.mjs
bash -n scripts/start-server.sh scripts/server-status.sh scripts/server-setup-token.sh scripts/backup-server.sh scripts/install-offline.sh scripts/package-server-release.sh deploy/server-lib.sh
```

这些测试验证随机密钥、重复执行不覆盖、权限、域名校验、拒绝执行配置中的命令、Compose 端口与资源限制，并使用模拟 Docker 验证离线包排除私密文件、校验篡改、拒绝错误架构和禁止联网拉取；不会连接线上 ECS，也不调用收费模型。
