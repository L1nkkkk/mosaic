# Mosaic · 拼页

用独立模块组合自己的展示空间。Public 公开页、Private 私人页与编辑台共用模块渲染器，由服务端控制数据范围。

内置开场介绍、手记、连接清单、服务器状态和 Bot 状态。可以增加、排序、隐藏和移除模块，在宽屏、窄屏预览中切换 Public / Private 范围。

## Public 与 Private

- `/`（也可用 `/public`）：访客只收到已发布、允许展示的 Public 模块。即使已经登录，这个入口也不会返回 Private 内容。
- `/private`：登录后查看全部已保存模块，包括 Public、Private 和暂时隐藏的模块；尚未发布的内容也可以在这里查看。
- `/edit`：编辑模块及其显示范围。新模块默认 Private，原有 0.1 版本的公开模块保持 Public。

点击保存后，私人页读取新内容。把模块改为 Private 并保存，会立即撤下对应的公开内容；把模块改回 Public 后，需要再次发布才会对访客显示。服务器状态和 Bot 状态固定为 Private，服务端拒绝将它们设为 Public。

显示范围与内容草稿保存在同一份数据中。Private 模块同时保留 `visible: false` 的兼容标记，以免旧版读取器忽略新增范围字段。升级后新增的模块类型需要部署对应代码才能读取，回退前请检查数据兼容性。

## 本地运行

需要 Node.js 24。应用没有第三方运行依赖，也不需要数据库服务。

```sh
node scripts/setup.js
node --env-file=.env server/index.js
```

第一次设置会生成 `.env` 并显示管理密码；不会覆盖已有配置。打开 `http://localhost:3000/`，编辑台在 `/edit`。`.env`、`data/` 不会提交到 Git。

```sh
npm test
npm run check
```

## 模块约定

新增 `modules/<id>/index.js` 和 `style.css`，无需改核心中的模块列表。模块导出：

- `meta`：`id`、名称、版本、说明、默认数据、布局（`wide` / `half`）。
- `meta.privateOnly`（可选）：为 `true` 时，只允许放在私人页，服务端强制执行。
- `validate(data)`：校验并规范化可持久化的数据。服务端保存和发布时调用。
- `render(data, resource)`：返回展示 HTML，所有用户文本必须转义，外链必须验证协议。可选资源结果在 `resource.value` 中，加载失败在 `resource.error` 中。
- `edit({ data, change })`：返回编辑控件；`change(next, refresh)` 更新内容，结构变化时传入 `true` 重新生成控件。
- `load({ request })`（可选）：加载实时数据，模块自行决定请求哪一个接口。私人页与编辑台每 30 秒刷新使用中的资源，同轮重复请求会合并。

模块只在 `edit()` 调用期间访问浏览器 DOM，保证校验可以在服务端运行。共用安全文本与表单工具在 `web/ui.js`；模块样式使用独立类名。新增模块代码必须经过可信的仓库维护者审查，它与主应用具有同等权限。

核心负责模块发现、编排、登录、草稿与发布，不理解单个模块的字段。部署前请确保现有内容使用的模块仍存在；改变已有模块的数据结构时需要兼容旧数据或显式迁移。

## 私人状态模块

`deploy/collect-status.py` 在宿主机上每 30 秒采集一次 CPU、内存、磁盘、运行时间，以及 AstrBot / NapCat 进程、QQ 登录和消息连接状态。它读取现有配置完成本机状态查询，仅输出数字、布尔值和采集时间；不会输出登录凭据、环境变量、聊天内容或日志。

网页容器只读挂载 `/var/lib/mosaic/monitor` 到 `/status`，不接触 Docker 管理接口或 bot 配置。受登录保护的 `/api/private/status` 再按字段白名单输出结果。采集失败时显示未知，超过 90 秒未更新时明确标记数据过期。

现有服务器上一次性安装状态采集：

```sh
sudo install -d -m 755 /usr/local/lib/mosaic /var/lib/mosaic/monitor
sudo install -m 644 deploy/collect-status.py /usr/local/lib/mosaic/collect-status.py
sudo install -m 644 deploy/mosaic-status.service deploy/mosaic-status.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start mosaic-status.service
sudo systemctl enable --now mosaic-status.timer
```

同时更新宿主机的 `mosaic-update` 脚本，让后续容器带上只读状态目录。已有页面可在编辑台添加这两个状态模块，保存后私人页即可显示。新建站点自带这两个 Private 模块。默认采集适配名为 `astrbot`、`napcat` 的容器，以及本机 6185 / 6099 端口；其他安装可调整采集脚本。独立部署或本地预览没有采集文件时，状态模块会显示等待采集。

## 数据与登录

`DATA_DIR/content.json` 同时保存草稿和发布版本，使用原子替换写入；保存带版本检查，两个编辑窗口不会静默覆盖。现有文件损坏时应用拒绝启动，不会自动清空内容。隐藏的模块不会进入公共内容接口。

单管理员密码使用 scrypt 哈希。会话签名、12 小时有效、HTTPS 下使用 Secure Cookie，写入请求校验来源，登录有速率限制。更换密码时同时轮换 `SESSION_SECRET` 以使已有会话失效。请通过备份文件恢复历史内容；第一版没有编辑历史和多人协作。

配置项：`PUBLIC_ORIGIN`（只包含协议与域名/端口）、`BASE_PATH`（可选，例如 `/mosaic`）、`ADMIN_PASSWORD_HASH`、`SESSION_SECRET`、`DATA_DIR`、`STATUS_FILE`（默认 `/status/status.json`）、`PORT`、`HOST`。生产容器监听内部网络，由 HTTPS 反向代理提供访问。

## GitHub → 自有服务器

1. 推送到 `main` 后，GitHub Actions 在 Node 24 容器内运行测试。
2. 测试通过后发布 `ghcr.io/l1nkkkk/mosaic:<commit>` 和 `:main` 镜像。首次发布后，确认 GitHub Packages 的容器包为 Public，并能匿名拉取；镜像不包含任何运行密钥或内容数据。
3. 服务器的 `mosaic-update.timer` 约每分钟检查一次公开镜像。候选版本先用内容副本检查模块兼容性和启动状态，再替换主容器；健康检查失败时恢复旧容器。切换时可能有几秒不可用。
4. `/var/lib/mosaic/data` 独立挂载，因此代码更新保留草稿与展示内容。服务器保留最近 5 次更新前的本地内容备份，以及上一容器用于回退。本地备份不能替代异地备份。

Actions 使用当前任务的 GitHub 自动令牌发布包；服务器只读取公开镜像，GitHub 中无需保存服务器登录私钥。

一次性服务器安装（需要 Docker、curl、systemd、flock）：

```sh
sudo install -d -m 700 /etc/mosaic /var/lib/mosaic
# 将私密配置写入 /etc/mosaic/app.env，权限 600；不要把它放在公开仓库。
sudo install -m 755 deploy/update.sh /usr/local/sbin/mosaic-update
sudo install -m 644 deploy/mosaic-update.service deploy/mosaic-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start mosaic-update.service
sudo systemctl enable --now mosaic-update.timer
```

`/etc/mosaic/deploy.conf` 可覆盖 `IMAGE`、`APP_DIR`、`NETWORK`、`BASE_PATH`、`PORT`、`ENV_FILE`，同样仅允许 root 写入。默认 Docker 网络 `astrnet` 必须已存在；反向代理将 `/mosaic/*` 原样转发到 `mosaic:3000`。管理应用的 `BASE_PATH` 必须与更新脚本相同。

容器默认限制为 0.5 CPU、192 MiB 内存；只读根文件系统，以普通用户运行，日志最多 10 MiB。构建发生在 GitHub，服务器负责下载和运行。

基础运行镜像在 `Dockerfile` 中固定了摘要，普通代码更新可以复用服务器已有镜像层。如果首次从 GHCR 下载基础层较慢，可先用服务器已有的 Docker Hub 加速源拉取 `Dockerfile` 中指定的 `node:24-alpine@sha256:...` 镜像。更新运行时摘要时，也应先测试并准备相同基础层。

检查更新和运行状态：

```sh
sudo systemctl status mosaic-update.timer
sudo journalctl -u mosaic-update.service -n 30
sudo docker inspect mosaic --format '{{.State.Health.Status}}'
```

手动回退前先停用自动更新，再将当前容器停止、移除并把 `mosaic-previous` 重命名为 `mosaic` 后启动。回退镜像保留当前内容；数据结构发生不兼容变化时，应同时从更新前备份恢复内容。修复 `main` 并发布后再启用更新计时器。
