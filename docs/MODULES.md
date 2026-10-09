# 模块开发手册

本文对应 Mosaic 0.10.x，以仓库当前实现为准。模块负责内容、编辑和内部尺寸适配；核心负责发现、权限、保存发布以及卡片外框。

[项目介绍](PROJECT.md) · [HTTP 接口参考](HTTP-API.md) · [返回 README](../README.md)

## 1. 接入第一个模块

先按[项目介绍](PROJECT.md)完成本地配置。静态 HTML 可继续使用下面的兼容模板；交互或画布模块推荐复制 `examples/live-card`，新生命周期接口见第 10 节。在仓库根目录复制静态模板：

```sh
cp -R examples/hello-card modules/hello-card
npm run check
node --env-file=.env server/index.js
```

如果服务已经运行，先停止旧进程再启动。打开 `/edit`，登录后选择「＋ 添加」→「问候卡片」。修改文字，拖动排序和右下角缩放，再点击「保存草稿」；此时私人页会看到新内容。需要公开时，把显示范围设为 Public、确保未隐藏，再点击「发布」。

模板有两个文件，可直接作为新模块起点：

- [`index.js`](../examples/hello-card/index.js)：完整的元数据、内容校验、展示与编辑接口。
- [`style.css`](../examples/hello-card/style.css)：独立类名、长文本换行、宽度和固定高度容器查询。

改名时同步修改目录名、`meta.id` 和 CSS 类名。例如目录 `modules/weather-card/` 对应 `meta.id: 'weather-card'`；CSS 类名也使用自己的前缀。不要将模板原样和改名版都提交为同一模块 ID。

`examples/` 不参与站点模块发现。已有站点部署新类型后，需要在编辑台手动添加实例；全新数据目录首次初始化时，会为每种已安装模块创建一个默认实例，非 `privateOnly` 类型的默认实例会公开，所以默认数据只能放演示内容。

## 2. 文件与运行环境

```text
modules/hello-card/
├── index.js       必须：导出模块接口
└── style.css      必须：浏览器自动加载
```

模块目录名必须匹配 `^[a-z][a-z0-9-]*$`，例如 `hello-card`。核心按目录名发现模块，无需修改注册表。目录符合命名规则却缺少有效入口、必要导出或有效默认数据时，会使检查或启动失败。

`index.js` 同时会被 Node.js 和浏览器导入。使用原生 ES module 和带扩展名的相对路径；不要在入口引入 Node 专用包，也不要在文件顶层访问 `document`、`window` 或发起网络请求。旧入口的 DOM 操作放在 `edit()` 或 `mount()` 中；实时数据请求放在 `load()` 中。新模块使用分离的 `definition.js` 与 `client.js`，浏览器入口可以在顶层导入依赖 DOM 的库，服务端不会执行它。

当前没有 TypeScript、JSX、npm 裸包名或构建转换支持。可以拆分相邻 JS 文件，用 `import './helper.js'` 引入；生命周期以第 10 节为准。

## 3. 导出接口总览

| 导出 | 必需 | 执行位置和返回值 |
| --- | --- | --- |
| `meta` | 是 | 两端读取；普通、可序列化的对象 |
| `validate(data)` | 是 | 服务端同步执行；返回规范化的 JSON 数据，失败抛出 `Error` |
| `render(data, resource)` | 旧静态契约必需 | 浏览器同步执行；返回 HTML 字符串 |
| `edit({ data, change })` | 是 | 浏览器选中模块时执行；返回编辑控件 DOM 元素 |
| `load({ request, id, data })` | 否 | 各页面按实例在浏览器异步执行；返回资源数据或 Promise |

这些接口不约定 `this` 的含义。旧静态契约可继续只用 CSS 容器查询；新生命周期通过 `context` 获取实例 ID、尺寸、主题与可写状态。权限始终由服务端强制执行。

### `meta`

```js
export const meta = {
  id: 'hello-card',
  name: '问候卡片',
  version: 1,
  description: '一段标题与正文，可适应不同卡片尺寸。',
  layout: { span: 6, minWidth: 280 },
  defaultData: { title: '你好，Mosaic', body: '从第一块内容开始。' },
  // privateOnly: true, // 仅允许作为 Private 模块时启用
};
```

| 字段 | 约定 |
| --- | --- |
| `id` | 与目录名完全相同，作为页面实例的 `type`；发布后保持稳定 |
| `name` | 编辑器显示名称 |
| `version` | 模块版本描述，现有模块使用整数；不会自动迁移内容 |
| `description` | 添加模块时的说明 |
| `defaultData` | 新实例的数据，核心复制后交给编辑器；必须通过 `validate()`，建议本身就是规范格式 |
| `layout` | 推荐外框尺寸，具体规则见第 5 节 |
| `privateOnly` | 可选布尔值，设为 `true` 后服务端禁止 Public；省略则可选两种范围 |

目录接口会返回整个 `meta`，浏览器也可以直接读取模块源码。`privateOnly` 保护实例内容和权限，不隐藏代码或默认数据；不要在元数据里放凭据。

### `validate(data)`

校验发生在模块默认值检查、启动时的已有内容检查，以及页面读取、保存和发布过程中。返回新的、仅包含允许字段的普通对象；失败时抛出适合直接显示给用户的错误。

```js
import { text } from '../../web/ui.js';

export function validate(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('卡片内容需要是一个对象。');
  }
  return {
    title: text(data.title, 100, '标题', '你好，Mosaic'),
    body: text(data.body, 3000, '正文'),
  };
}
```

保持同步、无副作用，不访问 DOM、网络或文件，不修改传入对象。结果必须能保存为 JSON：不要返回函数、DOM、`BigInt`、循环引用或仅在内存中有意义的对象。数组要限制数量，文本要限制长度，数字要检查类型、范围和有限性。

表单的 `maxLength` 只改善输入体验，不能代替服务端校验。编辑中的预览可能收到尚未校验的字段，因此 `render()` 仍须独立转义文本。

### `render(data, resource)`

返回单个 `<article>` 根元素是推荐做法。核心把结果写入内容框的 `innerHTML`，**不会自动清洗 HTML**。

```js
import { escape } from '../../web/ui.js';

export function render(data) {
  return `<article class="hello-card">
    <h2>${escape(data.title)}</h2>
    <p>${escape(data.body)}</p>
  </article>`;
}
```

文本和 HTML 属性值都需要 `escape()`；URL 还需要 `safeLink()` 检查协议。不要把用户提供的字符串直接作为 HTML、内联样式或事件处理器插入。

渲染可能因编辑、排序、尺寸变化后的重绘或资源刷新而反复执行，原来的展示 DOM 可能被整体替换。保持此函数纯粹：不注册事件、不启动定时器、不写存储、不发请求。当前没有展示 DOM 的挂载、卸载或清理回调；复杂可交互组件需要先扩展这一契约。

### `edit({ data, change })`

返回模块自己的编辑字段，不必重复实现显示范围、尺寸、排序、保存或发布按钮。

```js
import { field, fields } from '../../web/ui.js';

export function edit({ data, change }) {
  return fields(
    field('标题', data.title, value => change({ ...data, title: value }),
      { maxLength: 100 }),
    field('正文', data.body, value => change({ ...data, body: value }),
      { multiline: true, maxLength: 3000 }),
  );
}
```

`change(next, refresh = false)` 把 `next` 的字段合并进当前实例的 `data`，标记未保存并更新预览。它不会调用保存接口，也不会更新其他同类型实例。

- 普通输入使用默认的 `false`，避免每次输入重建控件而丢失焦点。
- 新增、删除或重排列表项后，用 `change({ ...data, items: nextItems }, true)` 重建编辑字段和模块列表；按钮应使用 `type="button"`。
- 合并使用 `Object.assign`，省略已有字段不会删除它。推荐传完整内容对象；清空字段时传明确的空值，数组变化时传整个新数组。
- 不要直接修改 `data` 后跳过 `change()`，否则核心无法正确记录未保存状态。

完整的动态列表范例见 [`modules/links/index.js`](../modules/links/index.js)。

## 4. 类型、实例和内容

模块类型的 `meta.id` 与页面实例的 `id` 是两回事。多个实例可以有相同的 `type`，但每个实例在页面内必须有独立 `id`。

```json
{
  "id": "hello-01",
  "type": "hello-card",
  "audience": "private",
  "visible": false,
  "layout": { "span": 4, "height": 280 },
  "data": { "title": "我的卡片", "body": "实例自己的内容。" }
}
```

`id`、`type`、`audience`、`visible`、`appearance` 和 `layout` 由核心管理，模块只负责 `data`。实例 ID 长 1～64，允许字母、数字、下划线和连字符；顺序由页面 `modules` 数组决定。服务端会移除实例层的未知字段。

编辑台添加的实例默认 Private。Private 实例规范化后总是 `visible: false`，但仍然显示在私人页；`visible` 只决定 Public 模块是否公开展示。完整保存、发布与权限规则见 [HTTP 接口参考](HTTP-API.md)。

## 5. 尺寸与内部适配

### 模块默认尺寸与实例覆盖

| 位置 | 字段 | 取值与作用 |
| --- | --- | --- |
| `meta.layout` | `span` | 1～12 整数，默认 6；12 为整行，6 为半行，4 为三分之一行 |
| `meta.layout` | `minWidth` | 0～4096 有限数值，默认 280，单位 CSS 像素；空间不足时扩大占列数 |
| `meta.layout` | `aspectRatio` | 可选，0.1～10 的宽 / 高；省略则自然内容高度 |
| 实例 `layout` | `span` | 可选，1～12 整数，覆盖推荐占列数 |
| 实例 `layout` | `height` | 可选，120～1600 整数 CSS 像素，覆盖内容框高度并优先于宽高比 |

两种 `layout` 只接受表中的字段，不能把 `height` 写到 `meta.layout`，也不能在实例里设置 `minWidth` 或 `aspectRatio`。旧的模块声明 `'wide'` / `'half'` 仍兼容，新模块使用对象形式。

用户拖动尺寸时，宽度按 12 列吸附、高度按 8 像素吸附；只横向拖动保留自动高度。键盘也可以调整，模块不需要接入这些事件。清空手动高度后恢复模块比例或自然高度，「恢复推荐尺寸」清除全部实例覆盖。

### 核心怎样排布

核心根据网格的实际容器宽度、间距和 `minWidth` 计算占列数。先尝试偏好的 `span`，再尝试比它大的 2、3、4、6、12 列档位。例如 4 列放不下时，尝试 6 列，再尝试 12 列。

`minWidth` 是舒适宽度，不是强制最小 CSS 宽度。容器比它更窄时仍占整行，模块仍须能够缩窄。窗口变化不会改写保存的尺寸偏好；默认 `flow: 'grid'` 按行换行；可选 `flow: 'masonry'` 按数组顺序依次放到可容纳其宽度的最低位置，动态高度变化会重新排布，窄屏自动单列。DOM / 键盘顺序不变，多列时视觉行序可能与数组顺序不同。

### 模块拿到的容器

下图是核心提供的结构，供理解尺寸关系；模块不应修改或依赖这些外框类名来操纵页面：

```text
.module-slot                 宽度查询容器
├── 编辑工具 / 范围标签        只在相应编辑预览中出现
└── .module-frame            圆角外框；固定尺寸时为宽高查询容器
    └── .module-content      固定尺寸时可滚动
        └── .module-surface     稳定挂载点（可选 ShadowRoot）
            └── article.hello-card  模块自己的根元素
```

`height` 和 `aspectRatio` 约束内容框，不包含编辑工具和范围标签。自动高度时内容自然撑开；固定尺寸时内容区提供滚动和键盘访问。核心不会缩小文字来塞满卡片。

给内部样式加模块前缀，避免裸写 `h2 {}`、`button {}` 或修改 `.page-grid`。根元素不要写固定宽度；长文本允许换行，图片等内容限制最大宽度。可使用核心已有的 `--white`、`--line`、`--ink`、`--muted` 色彩变量。

```css
.hello-card { min-width: 0; padding: 28px; }
.hello-card h2 { overflow-wrap: anywhere; }
.hello-card p { white-space: pre-wrap; overflow-wrap: anywhere; }
.hello-card img { display: block; max-width: 100%; height: auto; }

/* 看卡片宽度，不是整个浏览器窗口宽度。 */
@container (max-width: 360px) {
  .hello-card { padding: 18px; }
}

/* 只有手动高度或固定比例外框提供高度查询。 */
@container (max-height: 220px) {
  .hello-card { padding: 16px; }
  .hello-card p { margin-top: 8px; line-height: 1.6; }
}
```

不要为了缩小高度隐藏必要内容。可以调整内部列数、间距和字号，剩余长内容由核心滚动框承载。尺寸和校验实现见 [`web/layout.js`](../web/layout.js)，编辑手势见 [`web/arrange.js`](../web/arrange.js)。

## 6. 可选的实时资源 `load({ request, id, data })`

`load()` 在浏览器调用已有的 JSON 接口，返回值经核心包装后作为 `render()` 或 `update()` 第二个参数。它不运行在服务器，不能读取宿主机文件或秘密配置。

下面片段用于 **`meta.privateOnly: true` 的模块**，替换该模块的 `render()` 并补充 `load()`；其余必需导出保持不变：

```js
import { escape } from '../../web/ui.js';

export async function load({ request }) {
  return request('private/status');
}

export function render(data, resource) {
  const snapshot = resource?.value;
  const cpu = snapshot?.server?.cpuPercent;
  const message = resource?.error
    ? resource.error
    : !snapshot?.available ? '等待状态采集'
    : snapshot.stale ? '数据已过期，请等待更新'
    : typeof cpu === 'number' ? `CPU 使用率 ${cpu.toFixed(1)}%`
    : 'CPU 状态未知';
  return `<article class="hello-card">
    <h2>${escape(data.title)}</h2><p>${escape(message)}</p>
  </article>`;
}
```

`request(route)` 只接收相对于 `api/` 的路由，例如 `'private/status'`，不要写成 `'/api/private/status'` 或完整 URL。它发送同源 GET 请求，携带现有会话并解析 JSON；失败抛出带 `status` 的错误。不要吞掉 401，否则核心无法正确处理会话过期。

当前调度规则：

- 公开页、私人页和编辑台首次加载时请求，以后页面可见时约每 30 秒刷新；私人页也有手动刷新。
- 按使用中的**实例**调用一次 `load()`，传入 `id` 和该次刷新时的 `data` 副本；结果按实例 ID 保存。可用数据参数组成接口查询。
- 同一刷新轮里，相同 `request()` 路由共享同一个请求，即使来自不同模块类型。
- 成功时 `resource` 是 `{ value: 返回值 }`；失败时是 `{ error: '状态暂时无法读取' }`；也可能尚未加载而是 `undefined`。
- Public 的资源接口必须允许匿名读取。编辑台 Public 预览仍处于登录环境，不能据此判断匿名访客能否读取数据。

不要用模块级变量保存“当前实例”。`load()` 接收一次数据快照；编辑字段后下一轮读取新参数。实例内部的即时请求可用 `context.request()`，异步任务要检查 `context.signal.aborted`，并处理先后请求响应顺序。

需要访问新数据源时，在服务端明确增加路由、鉴权和字段白名单，再让模块请求它；增加模块文件不会自动注册 HTTP 路由。秘密凭据只保存在服务端配置中。现有状态接口结构见 [HTTP 参考](HTTP-API.md)，完整模块见 [`server-status`](../modules/server-status/index.js)。

## 7. 共用工具与资源路径

从 `../../web/ui.js` 导入：

| 工具 | 行为 |
| --- | --- |
| `escape(value)` | 转义 `& < > " '`，`null` / `undefined` 变为空字符串；不解析 Markdown |
| `text(value, max, label, fallback = '')` | 字符串类型和长度校验后去除首尾空白；仅 `undefined` 使用默认值；允许空字符串 |
| `safeLink(value)` | 允许空值或完整的 HTTP / HTTPS URL；拒绝相对路径、`javascript:`、`data:` 等协议 |
| `field(label, value, onChange, options)` | 带标签的文本输入；选项为 `multiline`、`maxLength`、`placeholder`；输入时回调 |
| `fields(...elements)` | 将字段组合为编辑面板 DOM 元素 |

`text()` 不检查必填，必要时另行拒绝空字符串；长度遵循 JavaScript 字符串的 `.length`。外链可用 `escape(safeLink(url))` 写入 `href`，新窗口链接同时设置 `rel="noopener noreferrer"`。

模块资源可以放在自己的目录中。JS 里用 `new URL('./icon.svg', import.meta.url).href`，CSS 里用 `url('./icon.svg')`，以兼容 `/mosaic` 等部署前缀。静态服务当前支持 `.js`、`.css`、`.svg`、`.png`、`.woff2`；增加其他资源类型需要修改服务端支持列表。

当前内容安全策略默认只允许同源脚本、样式和网络请求，图片允许同源及 `data:`。CDN 脚本、外部图片、第三方直接请求和 HTML 内联脚本不属于现有默认能力。普通 HTTP / HTTPS 外链跳转不受上述资源加载限制。

## 8. 兼容、检查与排错

### 修改已有模块

保持 `meta.id` 稳定，新增字段在 `validate()` 里补默认值。`meta.version` 只是信息，没有自动迁移执行器。重命名、删除类型或收紧旧数据限制，可能让服务器启动和候选部署检查失败，因为草稿与发布版本都会被校验。

在更改结构前检查两份内容的兼容性。确需迁移时，提供有备份、可回退的明确步骤；不要通过删除内容文件来解决兼容错误。

### 提交前验证

```sh
npm test
npm run check
npm run test:browser  # 需要 Chrome / Chromium
```

`npm run check` 验证服务端定义、默认数据、声明尺寸、初始页面、CSS 存在与 JS 语法；不会在 Node 中执行浏览器入口，也不证明 HTML 安全或生命周期正确。浏览器测试覆盖示例生命周期、动画、交互保存、实验台和旧滚动回归。`npm test` 运行仓库的现有测试，新模块特有的字段和错误分支需要相应测试或实际验证。

在编辑台检查：

1. 添加同类型两个实例，编辑互不影响；保存后刷新仍保留内容和尺寸。
2. 拖动顺序、半行与整行宽度、120 像素最小高度、自动高度、窄屏和长文本，都可正常使用。
3. 输入 `< > & " '` 等字符按文字展示，超长、错误类型和非法链接在保存时被拒绝。
4. Public 发布后的匿名访问、Private 保存后的登录访问都符合预期；实时模块另外检查未采集、过期、请求失败和会话失效。

| 现象 | 优先检查 |
| --- | --- |
| 新模块不在添加列表 | 目录名和 `meta.id`、必需导出、是否已重启服务并刷新页面 |
| 服务器启动失败 | 默认数据、尺寸字段、已有草稿和发布内容是否通过新版本校验 |
| 提示模块暂时无法显示 / 编辑 | 浏览器中的导入、`render()`、`mount()`、`update()`、`edit()` 错误；检查客户端和服务端依赖边界 |
| 样式没有生效 | `style.css` 路径、独立类名、浏览器网络请求和 Shadow DOM 样式范围 |
| 卡片没有变窄 | `minWidth` 正在扩大占列数，或模块内部写死了宽度；检查实际容器尺寸 |
| 高度查询不起作用 | 当前是否为自动内容高度；高度查询需要手动高度或 `aspectRatio` |
| 保存后公开页没更新 | 普通修改需要发布；确认实例为 Public 且未隐藏 |
| 本地状态一直等待采集 | 本地未配置 `STATUS_FILE` / 状态采集，或文件不可读 |
| 公开页实时数据为空 | 检查资源接口是否允许匿名读取，不要依赖编辑预览中的已登录结果 |
| 新字段保存后消失 | `validate()` 没有返回该字段，或把它误放在实例层而非 `data` 中 |

底层契约见 [`server/modules.js`](../server/modules.js)，浏览器调用方式见 [`web/app.js`](../web/app.js)。变更契约时应同时更新本手册和模板。

## 9. 代理节点模块

`proxy-nodes` 是仅私人可见的实时模块，按现有 `meta / validate / render / edit / load` 契约实现。`load()` 请求 `private/proxies`，同轮请求相同路径会合并，实例各自接收快照；标题独立编辑。内部表格在窄容器改为两列节点卡片，固定高度时使用核心滚动容器。

宿主机的 `deploy/collect-proxies.py` 每 15 分钟读取现有 Mihomo JSON 配置，启动短时、独立的 Mihomo 进程，为每个节点建立绑定 `127.0.0.1` 且带随机密码的 mixed listener。请求固定 HTTPS 服务查询出口后终止进程、清理临时配置；不切换运行中的策略组，不修改原配置，也不开放公网端口。每轮最多 100 个节点、4 路并发，每个节点最多两次有超时限制的请求。

- 主要出口与地区服务：[ipwho.is](https://ipwhois.io/documentation)；失败后通过 [ipify](https://www.ipify.org/) 只查询 IP。地区未知时不推测。
- 独立探测通过 Mihomo 的 [listener `proxy` 字段](https://wiki.metacubex.one/config/inbound/listeners/) 固定出站。出口是查询服务看到的 IP，不是节点接入地址；提供商按目标路由时，其他网站可能看到不同出口。
- 延迟取生产 Mihomo 的最近探测记录，超过 20 分钟无有效记录则显示未知；不把 IP 查询接口响应时间冒充网络延迟。绿色 <300 ms，黄色 300–799 ms，红色 ≥800 ms。
- IP 观察记录保存在宿主机 `proxy-history.json`（0600）。成功时累计观测次数、变化次数、首次/最后成功及连续未变时间。失败不推进成功记录；配置变化会重置对应节点历史，避免订阅复用编号造成混淆。
- 稳定性灰灯“尚待观察”、蓝灯“暂未变化”、黄灯“曾变化”。本模块不从地理位置、机房 IP 或短期不变推断静态性；始终明确“静态 IP 未确认”，需要供应商证据才能确认。
- 采集失败保留旧快照，超过 20 分钟标过期；单节点失败保留历史 IP 并标“上次成功结果”。红灯表示出口查询失败，不保证该节点对所有网站都不可用。

安装（要求现有 `/opt/mihomo/build/mihomo`、JSON 格式 `/opt/mihomo/state/config.yaml`、curl、Python 3.10+）：

```sh
sudo install -m 644 deploy/collect-status.py deploy/collect-proxies.py /usr/local/lib/mosaic/
sudo install -m 644 deploy/mosaic-proxies.service deploy/mosaic-proxies.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start mosaic-proxies.service
sudo systemctl enable --now mosaic-proxies.timer
```

网页通过已有 `/status` 只读挂载读取 `proxies.json`，默认文件可用 `PROXY_STATUS_FILE` 覆盖。Web 容器不接触 Docker 管理接口、Mihomo 配置或控制接口。接口独立鉴权与字段白名单，详见 HTTP 参考。已存在的页面部署代码后，需要添加一个“代理节点”实例并保存，无需发布公开页。

检查：`npm test`、`npm run check`、`python3 -m unittest discover -s test -p '*_test.py'`。采集器测试覆盖出口变化、失败保留、编号复用和公网 IP 校验；接口/渲染测试覆盖匿名拒绝、不可公开、白名单、过期数据及 HTML 转义。

## 10. 持久实例：推荐的新模块契约

```sh
cp -R examples/live-card modules/live-card
npm run check
node --env-file=.env server/index.js
```

进入 `/lab`（部署前缀下为 `/mosaic/lab`）选择「交互卡片」。点击计数是临时运行态，改变宽高和内容后仍保留；「重新挂载」才将计数归零。正式使用在编辑台添加，保存或发布。

```text
modules/live-card/
├── definition.js   meta + validate；服务端安全、同步、无副作用
├── client.js       mount + edit；可选 load；推荐重导出 validate
└── style.css       模块样式
```

发现 `definition.js` 时优先使用分离契约，必须同时存在 `client.js`。只有定义文件及它导入的代码会在 Node 执行；不要从定义文件反向导入客户端。目录响应里的 `entry` 指向 `client.js`。客户端 `meta` 不必重复导出，核心使用服务端目录返回的元数据。静态 `index.js` 继续按原契约发现，不要求迁移全部旧模块。

### 挂载与生命周期

```js
export function mount(context) {
  const title = document.createElement('h2');
  context.root.append(title);
  let clicks = 0; // 当前实例自己的临时状态
  title.addEventListener('click', () => { clicks++; }, { signal: context.signal });
  return {
    update(data, resource) { title.textContent = data.title; },
    resize({ width, height, pixelRatio }) { /* 调整画布或内部布局 */ },
    setActive(active) { /* 可见且页面在前台、未手动暂停 */ },
    frame(time, delta) { /* 毫秒时间戳和毫秒间隔；仅绘制，不读写布局 */ },
    dispose() { /* 释放 GPU、连接和自行注册的监听器 */ },
  };
}
```

`mount()` 必须同步返回实例对象，生命周期方法均为同步、可选。异步加载放在 `load()` 或自己管理的可取消任务中。初次挂载后会调用一次 `update()`；后续仅在内容、资源、可写状态或外观改变时调用。`update()` 复用 DOM，避免用 `innerHTML` 重建输入、画布或整个场景。

核心按实例 `id + type` 复用挂载点。排序、缩放、选中、保存、普通资源刷新不重新调用 `mount()`；移除实例、类型变化、从当前预览范围消失、退出或离开页面会清理。切回已隐藏的实例会新挂载，不保证运行态跨页面导航或范围隐藏保留。持久内容应显式保存，不能依赖闭包长期存活。

旧模块由 `render()` 适配器承接：内容不变时不重复写 HTML；内容变化时可能替换内部 DOM。旧模块滚动位置仍保留；需持续交互状态的模块应使用 `mount()`。

### `context`

| 字段 / 方法 | 约定 |
| --- | --- |
| `root` | 专属 `HTMLElement` 或 `ShadowRoot`；只在其中管理 DOM |
| `id` | 当前实例 ID，不等于类型 ID |
| `data` | 当前内容的副本；更新内容用 `save()`，不要直接改它 |
| `resource` | 当前 `{ value }` / `{ error }` 或 `undefined`，只读使用 |
| `size` | 最近一次 `{ width, height, pixelRatio }`；初始可能是 0，等待 `resize()` |
| `theme` | 当前 CSS 主题的 paper / ink / muted / line / violet / white 色值；CSS 变量也可直接继承 |
| `appearance` | `card` 或 `bare`，默认 `card` |
| `writable` | 当前宿主是否允许 `save()`；公开页 / 公开预览为 false |
| `reducedMotion` | 用户是否启用了减少动态效果 |
| `signal` | 清理或模块失败时触发的 AbortSignal；用于事件、fetch 等生命周期绑定 |
| `request(route)` | 同源 JSON GET；相对 `api/` 路由；实验台模拟模式下拒绝直接请求 |
| `save(nextData)` | 替换本实例的完整内容，返回 Promise，成功值是新 data；失败抛错 |
| `invalidate()` | 可见且活跃时立即触发一次 `frame()`，适合交互后的按需绘制 |

保存行为随宿主变化：

| 宿主 | `save()` 结果 |
| --- | --- |
| 私人页 | 带 revision 写入服务器草稿；不会更新公开版本 |
| 编辑台全部预览 | 更新本地待保存草稿，仍需按「保存草稿」或「发布」 |
| 实验台可写模式 | 仅本次实验数据，刷新后丢弃 |
| 公开页、公开预览、实验台只读模式 | 拒绝保存 |

建议客户端重导出 `validate`：`export { validate } from './definition.js'`，用于编辑预览和实验台即时校验；服务端保存无论如何都会再次执行定义校验。`save()` 传完整下一份数据，不是部分字段；`edit({ change })` 仍然合并字段。模块在保存期间禁用重复提交，捕获错误并保留尚未提交的输入。私人页版本冲突会加载最新数据并报告失败，不自动覆盖；多个标签页共用同一全页 revision。

### 尺寸、动画与清理

`resize()` 收到实际内容区 CSS 像素宽高和最多 2 倍的像素密度。首次观察以及内容区尺寸改变时通知；不要把 backing canvas 的像素尺寸反过来当布局尺寸。画布推荐声明 `aspectRatio`，CSS 填满内容区，内部按 DPR 设置分辨率。示例 shader 还把最长边限制在 1536 backing pixels，降低 GPU 负担。

`meta.animation` 可省略或为 `demand`，表示只在更新、尺寸变化、激活或 `invalidate()` 时绘制；设为 `continuous` 订阅核心共享的动画时钟。后台标签页、离屏、实验台暂停时不连续绘制；减少动态效果时停用连续帧，保留一次性绘制。`delta` 为毫秒，限制为不超过 100，避免重新进入前台时跳跃。动画逻辑应累积 delta，静止速度设为 0。

`setActive()` 代表可见性与宿主暂停状态，不代表账号权限，也不因为减少动态效果而自动变 false。音频、业务请求和媒体播放不应直接套用视觉暂停规则。不要另建每模块永不停止的动画循环。

移除时核心断开尺寸 / 可见性观察器、取消动画订阅并 abort signal。模块负责释放自己创建的 GPU 对象、WebSocket、定时器、Worker 及未绑定 signal 的监听器。生命周期抛错会隔离本模块并清理，其他模块继续运行；重新加载页面或在实验台重新挂载可以重试。

### 外观与可选样式隔离

实例 `appearance: 'bare'` 去掉核心圆角以及普通根 article 的背景、边框和阴影。需要保留自身画作背景的根元素可加 `data-own-background`，例如 shader 的渐变后备图。模块内部仍自行适配，核心不压缩文字或重排业务内容。

`meta.isolation: 'shadow'` 使用专属 ShadowRoot，并在其中加载 `style.css`；模块应 append 内容，不要删除核心注入的样式 link。全局组件样式不会进入 ShadowRoot，需在自己的 CSS 提供按钮、排版等规则，主题变量仍可继承。Shadow 模块通过 `context.appearance` 自己处理无边框外观。编辑字段位于普通编辑面板，应使用已有 field 工具或前缀样式。

Shadow DOM 只隔离样式，不隔离权限。当前模块仍是经维护者审查的可信代码；未加入在线代码执行、陌生来源模块安装或模块市场。复杂第三方引擎须在客户端显式引入同源代码，不能把密钥写进公开资源。本版采用模块各自的 WebGL 上下文，共享 GPU 服务留待实际需求再设计。

### 三类范例与实验台

- 静态文本：[`modules/note/index.js`](../modules/note/index.js)，兼容 render 示例。
- 有状态交互：[`modules/todo/client.js`](../modules/todo/client.js)，稳定列表、待提交输入、只读和保存失败处理；服务端定义见同目录 `definition.js`。
- WebGL：[`modules/shader/client.js`](../modules/shader/client.js)，真实 fragment shader、resize、frame、context lost / restored 与 dispose。
- 从零复制：[`examples/live-card`](../examples/live-card/)，最小生命周期模板。

实验台默认模拟数据；可切换成功、失败、空数据或显式读取真实接口。选择模块后能改宽高、外观、字段或 JSON，查看 mounted / active / size / reducedMotion / failed 状态，暂停或重新挂载。显示宽度会受实验台可用空间限制，运行状态里的 size 是实际值。实验台需要登录；它使用与正式页相同的宿主，不额外实现另一套渲染器。

## 11. 明暗主题适配

外壳使用 `web/theme.css` 提供主题颜色，模块仍负责自己的内部样式。优先使用 `--ink`、`--muted`、`--white`、`--paper`、`--line`、`--violet`、`--violet-soft`；状态色使用 `--positive`、`--negative`、`--warning`、`--blue` 及 `--positive-soft` / `--warning-soft`。不要写死白色卡片背景与浅色文字的组合。CSS 变量会自动随明暗切换，Shadow DOM 同样可以继承。

背景图片位于 `web/assets/alpine-dusk.jpg`，为本项目生成并随镜像分发，不依赖外部图片服务。模块自带照片 / 画布时可保持自己的颜色；例如介绍模块保留暗色封面，使用 `data-own-background` 避免无边框模式擦除图片背景。全站更换或关闭背景只影响应用外壳，不移除模块自己的封面。

## 历史图表模块范例

`modules/server-status/chart.js` 展示 `mount()` 如何持有 SVG、时间窗口与暂停状态：`update()` 更新数值并触发增量历史请求，`setActive()` 暂停屏幕外请求，`resize()` 用实际宽度重绘坐标，`dispose()` 阻止迟到的异步响应。图表没有注册 `frame()`，只在数据或尺寸变化时绘制。时间范围和浏览位置保存在实例中，刷新资源不会丢失；数据保存由服务器采集服务负责。


## 生活模块范例与素材复用（0.9）

- `modules/weather/`：`load({ request, data })` 按实例城市获取缓存资源；`cityKey` 防止编辑城市后展示旧城市的响应。
- `modules/music/`：持久 `<audio>` 实例；内容更新先比较音频地址，只有换曲时才 `load()`。`dispose()` 负责暂停并释放音频源，不在每次 `update()` 重建播放器。
- `modules/books/`：按书籍 ID 复用 DOM，支持本地上传封面、阅读状态和可选链接。
- `modules/photo/`：`object-fit: cover` 配合独立裁切字段；图片和遮罩留在模块内，外框尺寸由核心提供。
- `modules/visitors/`：只读统计资源，持久 SVG、更新标记与数值；空数据与接口失败分别显示。

共用辅助文件 `modules/media.js` 导出：

```js
import { mediaUrl, mediaField, imageElement } from '../media.js';
// validate() 内：空字符串表示未配置。
const cover = mediaUrl(data.cover); // 只接受本站已上传图片路径
const audio = mediaUrl(data.audio, 'audio'); // 本站音频或 HTTPS 直链
// edit() 内：返回 DOM 节点；上传完成会调用 change(url)，仍需保存草稿。
const control = mediaField('封面', data.cover, cover => change({ cover }));
// mount()/update() 内：相同 URL 不重复设置 src，空值隐藏图片。
imageElement(img, data.cover, data.title);
```

素材引用应作为数据中的独立字符串保存，格式是 `api/media/<sha256>.<扩展名>`，不要拼接查询参数、嵌入 HTML 或改成绝对 URL。后端递归读取草稿与发布数据中的规范路径来决定保留和公开权限；只存在前端内存中的引用不算已保存。图片只通过上传接入，不允许任意远程图片 URL。音频直链由浏览器访问，不由服务器代理下载。

新增资源接口仍需明确实现后端路由，不能让模块提供任意上游 URL。天气和访客的服务端实现分别位于 `server/weather.js`、`server/visitors.js`；`server/external.js` 提供超时、响应大小上限和缓存。五个模块都没有向核心加入自己的尺寸分支。


### 当前展示环境与音乐状态（0.10）

`context.view` 是只读的当前环境：`public`、`private`、`edit` 或 `lab`，默认 `public`。可用于避免在编辑器或实验台自动播放，不作为权限边界；授权仍依赖服务端。旧模块无需修改。

音乐数据增加 `mode`（`sequence / loop / single / shuffle`，默认 `sequence`）与 `autoplay`（布尔值，默认 false）。歌曲增加可选 `neteaseId` 和 `neteaseCover`；本地 `cover` 优先。网易云播放地址有时效，不能写入草稿，按当前歌曲使用 `context.request('music/netease?id=…')` 读取。`generation` 标识切歌请求，丢弃迟到的旧响应；`dispose()` 后的响应同样不应用。`source.js` 负责规范链接、有限模式的选曲规则，播放器保留原生音频节点并处理 `play()` Promise 的拒绝。
