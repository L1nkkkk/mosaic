# HTTP 接口参考

本文对应 Mosaic 0.5.x，供模块作者理解数据来源，也供维护者接入已有编辑流程。普通模块通过 `edit({ change })` 或生命周期 `context.save()` 更新草稿，不需要自行调用保存接口。

[项目介绍](PROJECT.md) · [模块开发手册](MODULES.md) · [返回 README](../README.md)

## 1. 路径、会话与请求约定

以下路径相对于 `BASE_PATH`。本地默认是 `/api/page`；部署前缀为 `/mosaic` 时是 `/mosaic/api/page`。`PUBLIC_ORIGIN` 只含协议、域名和可选端口，例如 `http://localhost:3000`，不含 `/mosaic`。

- 接口返回 JSON，带 `Cache-Control: no-store`。
- 登录后使用 `mosaic_session` Cookie，没有独立的 Bearer Token / API Key 接口。会话有效期 12 小时，Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下加 Secure。
- 所有 POST / PUT 请求都必须带与 `PUBLIC_ORIGIN` 完全相同的 `Origin`。有请求体的接口使用 `Content-Type: application/json`，请求体为 JSON 对象，最多 128 KiB。
- 浏览器在同源环境中自动管理 `Origin` 和 Cookie；不要把管理密码或会话写入模块代码。
- 错误通常为 `{ "error": "可显示的错误说明" }`。

## 2. 路由表

| 方法与路径 | 需要登录 | 请求体 | 成功返回 |
| --- | --- | --- | --- |
| `GET /api/health` | 否 | 无 | `{ ok, version, commit }` |
| `GET /api/session` | 否 | 无 | `{ authenticated }` |
| `POST /api/login` | 否 | `{ password }` | `{ ok: true }` 并设置会话 Cookie |
| `POST /api/logout` | 否 | 可发送 `{}` | `{ ok: true }` 并清除当前 Cookie |
| `GET /api/modules` | 否 | 无 | `{ modules: [ModuleMetaWithEntry] }`，排除 `privateOnly` 类型 |
| `GET /api/page` | 否 | 无 | `{ page, publishedAt, version, commit }`，仅已发布且未隐藏的 Public 实例 |
| `GET /api/private/page` | 是 | 无 | `{ page, revision, updatedAt, version }`，全部已保存草稿 |
| `PUT /api/private/module` | 是 | `{ revision, id, data }` | `{ page, revision, updatedAt }`，只改指定实例草稿内容 |
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
