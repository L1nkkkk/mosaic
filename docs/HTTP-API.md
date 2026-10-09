# HTTP 接口参考

本文对应 Mosaic 0.10.x，供模块作者理解数据来源，也供维护者接入已有编辑流程。普通模块通过 `edit({ change })` 或生命周期 `context.save()` 更新草稿，不需要自行调用保存接口。

[项目介绍](PROJECT.md) · [模块开发手册](MODULES.md) · [返回 README](../README.md)

## 1. 路径、会话与请求约定

以下路径相对于 `BASE_PATH`。本地默认是 `/api/page`；部署前缀为 `/mosaic` 时是 `/mosaic/api/page`。`PUBLIC_ORIGIN` 只含协议、域名和可选端口，例如 `http://localhost:3000`，不含 `/mosaic`。

- 除背景图片外，接口返回 JSON，带 `Cache-Control: no-store`。
- 登录后使用 `mosaic_session` Cookie，没有独立的 Bearer Token / API Key 接口。会话有效期 12 小时，Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下加 Secure。
- 所有 POST / PUT 请求都必须带与 `PUBLIC_ORIGIN` 完全相同的 `Origin`。除二进制背景上传外，有请求体的接口使用 `Content-Type: application/json`，请求体为 JSON 对象，最多 128 KiB。
- 浏览器在同源环境中自动管理 `Origin` 和 Cookie；不要把管理密码或会话写入模块代码。
- 错误通常为 `{ "error": "可显示的错误说明" }`。

## 2. 路由表

| 方法与路径 | 需要登录 | 请求体 | 成功返回 |
| --- | --- | --- | --- |
| `GET /api/health` | 否 | 无 | `{ ok, version, commit }` |
| `GET /api/appearance` | 否 | 无 | `{ revision, background, backgroundUrl }` |
| `GET /api/background/:hash.webp` | 否 | 无 | 公开的 WebP 图片；支持 HEAD、ETag、长期缓存 |
| `PUT /api/admin/appearance` | 是 | `{ revision, background: "default" 或 "none" }` | 更新后的外观设置 |
| `PUT /api/admin/background?revision=N` | 是 | `Content-Type: image/webp`，二进制静态图片 ≤ 512 KiB | 更新后的外观设置 |
| `GET /api/session` | 否 | 无 | `{ authenticated }` |
| `POST /api/login` | 否 | `{ password }` | `{ ok: true }` 并设置会话 Cookie |
| `POST /api/logout` | 否 | 可发送 `{}` | `{ ok: true }` 并清除当前 Cookie |
| `GET /api/modules` | 否 | 无 | `{ modules: [ModuleMetaWithEntry] }`，排除 `privateOnly` 类型 |
| `GET /api/page` | 否 | 无 | `{ page, publishedAt, version, commit }`，仅已发布且未隐藏的 Public 实例 |
| `GET /api/private/page` | 是 | 无 | `{ page, revision, updatedAt, version }`，全部已保存草稿 |
| `PUT /api/private/module` | 是 | `{ revision, id, data }` | `{ page, revision, updatedAt }`，只改指定实例草稿内容 |
| `GET /api/private/history?range=1h` | 是 | 无 | 限时历史数据，见下方历史说明 |
| `GET /api/private/status` | 是 | 无 | 状态快照，见第 6 节 |
| `GET /api/admin/modules` | 是 | 无 | `{ modules: [ModuleMetaWithEntry] }`，包括全部类型 |
| `GET /api/admin/state` | 是 | 无 | `State`，包括完整草稿和发布版本 |
| `PUT /api/admin/draft` | 是 | `{ revision, page }` | 更新后的 `State` |
| `POST /api/admin/publish` | 是 | `{ revision }` | 发布后的 `State` |

`ModuleMetaWithEntry` 为模块导出的整个 `meta`，其中 `layout` 已规范化，并增加 `entry`，例如 `"modules/hello-card/index.js"` 或 `"modules/todo/client.js"`。它是相对于站点基础路径的入口地址。公开目录会列出全部非 `privateOnly` 类型，不只列出当前已使用的类型。

## 3. 页面与状态结构

`Page` 示例：

```json
{
  "title": "我的空间",
  "modules": [
    {
      "id": "hello-01",
      "type": "hello-card",
      "audience": "public",
      "visible": true,
      "layout": { "span": 6, "height": 320 },
      "data": { "title": "你好", "body": "这是一块内容。" }
    }
  ]
}
```

此例需要先安装手册中的 `hello-card` 模块。页面标题去除首尾空白后不能为空，原始长度最多 80；模块最多 30 个。实例 ID 在页面内唯一，长 1～64，只允许字母、数字、下划线和连字符。模块内容由对应的 `validate()` 校验。

`Page.flow` 可省略（默认 `grid`），可设 `masonry`。实例 `appearance` 可省略（默认 `card`），可设 `bare`；无效模式会拒绝。

`layout` 可省略；只允许 `span`（1～12 整数）和 `height`（120～1600 整数 CSS 像素）。`audience` 为 `public` 或 `private`。Private 的 `visible` 被规范化为 `false`，但这不会隐藏私人页中的实例。

`State` 的结构如下，时间使用 ISO 8601 字符串：

```text
{
  schemaVersion: 1,
  revision: number,      // 当前写入版本，每次成功保存或发布递增
  draft: Page,          // 全部草稿实例
  published: Page,      // 完整发布快照，可能含有 Private 实例
  updatedAt: string,
  publishedAt: string
}
```

`admin/state` 只供已登录管理员使用。面向访客时必须读取 `/api/page`，不要将 `admin/state.published` 直接公开；它不是经过 Public 过滤的输出。

## 4. 保存、发布与访问范围

1. 读取 `GET /api/admin/state`，取得当前 `revision` 和 `draft`。
2. 修改草稿副本，用 `{ revision, page }` 保存到 `PUT /api/admin/draft`。
3. 使用保存响应里的**新 `revision`**，请求 `POST /api/admin/publish`。
4. 保存和发布都会递增版本，后续操作继续使用最新响应中的版本。

`409` 表示其他窗口已修改内容。保留本地未保存内容，重新读取状态并人工或有意识地合并，再提交；不要只获取新版本号后盲目重发旧页面。

| 操作 | 保存后私人页 | 保存后公开页 | 再发布后公开页 |
| --- | --- | --- | --- |
| 普通内容、顺序或尺寸修改 | 更新 | 保留旧发布内容 | 更新 |
| 添加 Private 实例 | 可见 | 不显示 | 仍不显示 |
| Public 改为 Private | 可见 | 同 ID 的已发布实例立即撤下 | 不显示 |
| Private 改为 Public | 可见 | 尚未公开 | 未隐藏时显示 |
| 隐藏 Public 实例 | 仍可见 | 保留旧发布内容 | 不显示 |
| 移除实例 | 不再显示 | 保留旧发布内容 | 不显示 |

立即收紧范围的规则按实例 ID 匹配。`privateOnly` 类型不能设为 Public，服务端拒绝保存。即使登录用户调用 `/api/page`，也不会得到 Private 数据。

下面是浏览器同源环境中的示例，**会保存并发布页面标题**。只在本地测试站点登录后执行；一般模块继续使用 `change()`，让编辑台处理保存与发布。

```js
async function requestJSON(route, method = 'GET', payload) {
  const response = await fetch(new URL(`api/${route}`, document.baseURI), {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const value = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(value.error), { status: response.status });
  }
  return value;
}

let state = await requestJSON('admin/state');
const page = structuredClone(state.draft);
page.title = '我的测试空间';
state = await requestJSON('admin/draft', 'PUT', {
  revision: state.revision,
  page,
});
state = await requestJSON('admin/publish', 'POST', {
  revision: state.revision,
});
```

## 5. 常见错误状态

| 状态 | 含义与处理 |
| --- | --- |
| `400` | JSON 格式、页面字段或模块数据不合法；修正后重试 |
| `401` | 登录失败或缺少有效会话；重新登录，保留尚未保存内容 |
| `403` | 写入请求的 `Origin` 不匹配；检查访问地址和 `PUBLIC_ORIGIN` |
| `404` | 路由或资源不存在；检查 `BASE_PATH`、路径和请求方法 |
| `405` | 使用了服务端不接受的全局方法；当前只接收 GET、HEAD、POST、PUT，具体路由仍按路由表匹配 |
| `409` | 保存版本冲突；重新读取并合并内容 |
| `413` | 请求体超过 128 KiB，或单实例保存后的草稿超过 120 KiB |
| `415` | 请求体不是 `application/json` |
| `429` | 登录尝试过多；遵循 `Retry-After`，不要连续重试 |
| `500` | 服务端异常；查看服务日志，接口仅返回通用错误 |

登录速率限制按来源地址统计，当前窗口为 15 分钟，最多 10 次尝试。不能把登录接口用作模块的周期性保活请求。

## 6. 私人状态快照

`GET /api/private/status` 需要登录。未采集或读取失败时仍返回 HTTP 200，内容为：

```json
{
  "available": false,
  "stale": true,
  "collectedAt": null,
  "server": null,
  "bot": null
}
```

可用时的字段结构：

```text
{
  available: true,
  stale: boolean,
  collectedAt: ISO时间字符串,
  server: null | {
    cpuPercent: number | null,       // 百分数，例如 3.3 表示 3.3%
    cpuCount: number | null,
    uptimeSeconds: number | null,
    memory: { total, used, available }, // 每个字段为字节数或 null
    disk: { total, used, available }    // 每个字段为字节数或 null
  },
  bot: null | {
    astrbot: { running, restarts, uptimeSeconds },
    napcat: { running, restarts, uptimeSeconds },
    webuiReachable: boolean | null,
    onebotConnected: boolean | null,
    qqOnline: boolean | null
  }
}
```

容器状态里的 `running` 为布尔值或 `null`，`restarts` 和 `uptimeSeconds` 为非负数或 `null`。其他数值字段也可能是 `null`；不要把未知当成 0、离线或故障。

采集超过 90 秒未更新，或采集时间比当前时间超前超过 10 秒时，`stale` 为 `true`。模块应分别处理未采集、部分字段未知、过期和请求失败，不能只看 HTTP 200。

接口只输出白名单中的状态值，不包含凭据、宿主机配置或聊天内容。增加采集字段时，需要同步修改采集端、[`server/status.js`](../server/status.js) 的白名单和相应测试。采集安装方式见 [README](../README.md)。

## 7. 扩展新服务端接口

模块目录不会自动注册后端路由。需要新数据源时，由维护者在 [`server/app.js`](../server/app.js) 增加明确路由，并决定它是否需要登录、输出哪些字段以及如何处理失败。

私密数据路由必须在服务端做鉴权；前端选择 Private 或模块 `privateOnly` 声明，不能代替接口权限检查。模块源码和 `/web/`、`/modules/` 静态资源本身公开可读。不要将凭据、令牌、完整配置或未经筛选的第三方响应直接返回给浏览器。

## 8. 节点出口快照

`GET /api/private/proxies` 必须登录，未登录返回 401。它读取 `PROXY_STATUS_FILE`（默认 `/status/proxies.json`），不直接调用 Mihomo。快照大小上限 256 KiB，节点和策略组各最多 100 项；未知字段被删除。

```text
{
  available: boolean, stale: boolean, collectedAt: ISO时间 | null,
  groups: [{ name, selected }],
  nodes: [{
    name, reachable: boolean | null, checkedAt: ISO时间 | null,
    ip: IP地址 | null, country, countryCode, region, city, isp,
    delayMs: number | null, delayAt: ISO时间 | null,
    firstSeen, lastSeen, stableSince: ISO时间 | null,
    samples: number | null, changes: number | null
  }]
}
```

未采集、损坏、无法读取时 `available: false, stale: true`，两个列表为空。采集超过 20 分钟或超前超过 10 秒时标过期；延迟记录过期也会单独清空延迟。节点 `reachable: false` 表示本轮出口查询失败，历史 IP 和地区仍可保留，但客户端必须标记历史结果。`samples` 为成功观测次数，`changes` 为成功观测之间的出口变化次数，两者不能确认静态 IP。地理信息为第三方数据库估算；快照不含节点地址、凭据、订阅 URL 或原始控制接口响应。

## 9. 模块自身保存

`PUT /api/private/module` 仅接受已登录、同源请求，使用整个内容文件的 `revision` 做乐观并发检查。查找草稿中的 `id`，用该类型的 `validate(data)` 校验并替换完整 `data`，不修改范围、尺寸、顺序或发布版本。多余的请求字段不参与更新；找不到实例返回 404，版本冲突返回 409，数据校验失败返回 400。草稿 JSON 超过 120 KiB 返回 413，为完整保存请求保留包装空间。

模块作者应使用 `await context.save(nextData)`，不要绕过核心直接调用这个接口。它根据当前页面区分本地编辑草稿、服务器草稿、实验草稿和只读状态。成功返回规范化后的 `data`；失败抛出错误。私人页遇到 409 会读取最新草稿并提示本次操作失败，不自动重放覆盖。编辑台保持原有冲突处理，保留未保存改动供人工合并。

## 全站背景与缓存

外观设置的 revision 与页面 State.revision 独立。旧版本写入返回 409，前端应重新读取 `/api/appearance` 并让用户重新选择。未登录写入返回 401；其他来源写入返回 403。背景更改立即生效，不经过草稿发布，也不更改页面数据。

`background` 为 `default`、`none` 或 64 位 SHA-256 哈希加 `.webp`；`backgroundUrl` 为相对于站点基础路径的地址，无背景时为 null。HTML 直接带有当前背景样式，避免先下载默认图再替换。配置错误或当前背景损坏会使启动预检失败，原数据保留。

浏览器上传器接受 ≤ 12 MB 的 JPG / PNG / WebP 原图，转为静态 WebP（最长边 ≤ 1920），必要时进一步压缩。服务器独立检查 512 KiB 上限、WebP 容器、静态类型及尺寸（各边 ≤ 3840，总像素 ≤ 800 万），拒绝 SVG 和远程图片 URL。不应在模块中改写全站背景。

普通静态资源使用 `ETag` 与 `max-age=0, must-revalidate`，未改动返回无正文的 304；上传背景以内容哈希命名并使用一年 immutable 缓存。HTML 与 JSON 接口保持 no-store。磁盘只保留当前及上一张上传背景，历史地址最终可能返回 404。

## 服务器历史接口

`GET /api/private/history` 必须登录，与其他 Private 接口共用权限。仅接受：

- `range`：`1h`（默认）、`6h`、`24h`、`7d`，分别返回 30 / 60 / 300 / 1800 秒粒度。
- `end`：可选，Unix 秒，固定查看区间的结束时间；限制在最近 7 天至当前时间。省略表示实时滚动。
- `since`：可选，Unix 秒；增量读取时传最后一个点的时间。接口会再次返回最后一个汇总桶，客户端按 `t` 替换，不能简单 append。

返回 `{ available, range, start, end, step, points, lastCollectedAt, retainedFrom }`。时间均为 Unix 秒。`points` 按时间升序排列；点格式为 `{ t, count, gap, cpu, memory, rx, tx }`，四项指标为 `{ avg, min, max }` 或 null。CPU / memory 单位为百分比；rx / tx 为字节每秒。`gap` 表示该段含缺测，客户端不应连接跨缺口的曲线；相邻点的时间差也需检查。没有记录时为空数组，不补零。

错误参数返回 400，未登录返回 401；历史文件暂缺、锁定或不可读时返回 `available:false`，当前状态接口仍独立工作。查询只读取数字白名单，服务器按文件更新时间复用每个范围的结果缓存。固定历史区间不自动追加数据；7 天视图只纳入结束时间之前完整采集的汇总桶。


## 生活模块接口（0.9）

以下路径相对于 `BASE_PATH`。写请求仍要求同源 Origin，管理请求还需要登录 Cookie。

| 方法与路径 | 权限 / 返回 |
| --- | --- |
| `GET /api/admin/cities?name=北京` | 管理员；2～80 字城市名，返回 `{ cities: [{name,region,latitude,longitude}] }`，最多 6 项；上游失败 503。 |
| `GET /api/weather?latitude=39.9&longitude=116.4` | 主人可预览有效坐标；匿名只可读取已发布、可见 Public 天气模块的坐标（规范化到三位小数），其他坐标 404。缓存 10 分钟，上游失败 503。 |
| `POST /api/admin/media` | 管理员；原始文件字节，不是 JSON / multipart。Content-Type 为 `image/webp`、`audio/mpeg`、`audio/wav`、`audio/ogg` 或 `audio/flac`。返回 `{url,bytes,type}`；格式错误 400 / 415，文件或配额超限 413，并发上传超限 429。 |
| `GET /api/media/<sha256>.<ext>` | 主人可预览上传素材；匿名仅可访问被已发布、可见 Public 内容引用的素材，否则 404。支持 HEAD 和单段 Range：206 / 416。所有素材响应 `Cache-Control: no-store`。 |
| `GET /api/visitors` | 主人可读取；匿名仅在已公开访客模块时可读取，否则 404。返回统计汇总，不返回地址或每日 HMAC 标识。 |
| `POST /api/visit` | 204；只有公开了访客模块、未登录主人、没有 DNT / GPC 时才采集。地域查询异步完成，不阻塞响应。 |

天气响应：`{available:true,fetchedAt,time,timezone,temperature,feelsLike,humidity,wind,code,isDay,forecast:[{day,code,high,low}]}`。温度为摄氏度、湿度百分比、风速 km/h、天气代码为 WMO；字段未知用 `null`。`time` 是城市当地时间；`fetchedAt` 是服务器获取时间。

访客响应：`{enabled,day,today:{views,visitors},totalViews,started,regionDays:30,regions:[{code,visitors}]}`。日期按 Asia/Shanghai 的日界线，`started` 没有采集时为 null；地区代码 `ZZ` 表示未知，分布按最近 30 天每日独立访客累计，所以同一人不同天可重复计入。只放在 Private 的访客卡不会开启采集，可读到以前累积的统计。缓存、数据保留和第三方查询细节见 README「生活模块」。


## 网易云歌曲接口（0.10）

- `GET /api/admin/netease?id=2700386313`：需管理员登录，返回 `{id,title,artist,cover,page}`，用于明确点击导入。只接受 1～16 位正整数歌曲 ID，不接受任意 URL，也不返回原始平台响应。
- `GET /api/music/netease?id=2700386313`：主人可预览；匿名只能请求已发布、可见 Public 音乐模块引用的歌曲 ID，否则 404。返回上述字段以及 `{audio,playable}`。`audio` 是短期的 HTTPS CDN 地址，空字符串表示当前未获取到可用外链。`playable:true` 只说明取得了合规地址，实际浏览器播放仍可能失败，必须处理 `audio.error` 和 `play()` 拒绝。

编号错误为 400，元信息上游失败为 503；元信息成功但外链不可用仍返回 200、`playable:false`。元信息缓存 6 小时，外链结果缓存 60 秒，最多缓存 100 首，各共享每分钟 60 次上游请求限额。没有音频转发代理，没有长期存储播放地址。上传素材的 ACL 不变；网易云外链受平台权限控制，无法由 Mosaic 撤销第三方已发出的链接。

## 私人游戏状态

新增 `GET private/games`、`POST private/games/refresh` 和 `PUT private/games/account`。所有接口要求登录；写入要求同源 Origin。凭据独立加密存储，不包含在页面 API 中。完整请求格式、缓存策略和状态含义见[游戏状态说明](GAMES.md)。
