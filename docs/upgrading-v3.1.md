# 已有网站升级到 v3.2.0

适用于已经在 `/opt/guanxing` 安装 v3.0 或 v3.1 系列离线包、配置好域名的网站。本次会自动为账号增加每日次数与 Token 上限字段，保留原配置、数据卷和 HTTPS 证书，不需要重新注册管理员或重新绑定域名。升级会短暂重启应用，先等当前解读完成。

## 1. 在自己电脑下载并上传

从 [v3.2.0 Release](https://github.com/xinglabs/guanxing/releases/tag/v3.2.0) 下载两个同名文件：部署包和 `.sha256`。服务器访问 GitHub 慢时，在电脑下载后上传更稳。

在电脑终端进入下载目录，将 `YOUR_SERVER_IP` 替换为服务器地址：

```bash
scp guanxing-v3.2.0-linux-amd64.tar.gz guanxing-v3.2.0-linux-amd64.tar.gz.sha256 root@YOUR_SERVER_IP:/opt/
```

## 2. 在服务器备份并升级

逐步执行；任一步报错就停止，不继续解压或安装。先确认备份显示 `Backup complete`。

```bash
cd /opt/guanxing
./scripts/backup-server.sh
./scripts/server-status.sh
```

再校验下载包，看到文件名后显示 `OK` 后继续：

```bash
cd /opt
sha256sum -c guanxing-v3.2.0-linux-amd64.tar.gz.sha256
tar -xzf guanxing-v3.2.0-linux-amd64.tar.gz --strip-components=1 -C /opt/guanxing
cd /opt/guanxing
./scripts/install-offline.sh
./scripts/server-status.sh
```

最后一项应显示应用版本 `3.2.0`。安装器沿用 `.env.server` 中的域名、数据库密码、`APP_SECRET` 和已有数据卷；不要删除这个文件，不要执行 `docker compose down -v`。

## 3. 打开网站

- 域名首页：动态星空封面。
- 域名后加 `/#reading`：用户排盘与自由对话。
- 域名后加 `/#admin`：管理员模型、用量、账号与站点设置。

管理员登录后自动进入后台，不需要出生资料或命盘；已有管理员登录状态从首页或旧 `/#agent` 入口进入也直接打开后台。后台「返回首页」回到动态封面。普通用户登录后仍按有无命盘恢复解读或填写出生资料。

本版只保留系统管理员和普通用户两种角色。在后台「站点管理」为每位用户设置每日提问次数和 Token 上限。次数留空沿用默认值，0 表示暂停提问；Token 0 表示不单独限制。修改上限不清空已用量。后台「用量」可以切换日期查看每位用户及全站当日、累计消耗。普通用户界面和接口不再提供模型设置、费用账本或剩余次数。

用原有普通用户账号登录，检查「我的解读」中的命盘与历史消息，管理员检查模型仍已配置 Key。最后发送一条真实问题验证模型连接；测试阶段没有代你消耗付费模型额度。

保留上一个版本包与本次备份。备份含私人对话和加密密钥，应复制到服务器之外的受保护位置。旧版不执行新增的用户 Token 限制，不能用回退程序恢复这些限制；确需回退时先关闭注册，再按升级前备份恢复。
