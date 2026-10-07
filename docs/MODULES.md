# 模块开发手册

本文对应 Mosaic 0.4.x，以仓库当前实现为准。模块负责内容、编辑和内部尺寸适配；核心负责发现、权限、保存发布以及卡片外框。

[项目介绍](PROJECT.md) · [HTTP 接口参考](HTTP-API.md) · [返回 README](../README.md)

## 1. 接入第一个模块

先按[项目介绍](PROJECT.md)完成本地配置。在仓库根目录复制模板：

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

`index.js` 同时会被 Node.js 和浏览器导入。使用原生 ES module 和带扩展名的相对路径；不要在入口引入 Node 专用包，也不要在文件顶层访问 `document`、`window` 或发起网络请求。DOM 操作放在 `edit()` 中；实时数据请求放在 `load()` 中。

当前没有 TypeScript、JSX、npm 裸包名或构建转换支持。可以拆分相邻 JS 文件，用 `import './helper.js'` 引入；不要依赖核心未提供的插件生命周期。

## 3. 导出接口总览

| 导出 | 必需 | 执行位置和返回值 |
| --- | --- | --- |
| `meta` | 是 | 两端读取；普通、可序列化的对象 |
| `validate(data)` | 是 | 服务端同步执行；返回规范化的 JSON 数据，失败抛出 `Error` |
| `render(data, resource)` | 是 | 浏览器同步执行；返回 HTML 字符串 |
| `edit({ data, change })` | 是 | 浏览器选中模块时执行；返回编辑控件 DOM 元素 |
| `load({ request })` | 否 | 私人页和编辑台在浏览器异步执行；返回资源数据或 Promise |

这些接口不约定 `this` 的含义，也没有传入实例 ID、尺寸对象或权限对象。模块应通过 CSS 容器查询读取可用空间，权限由核心和服务端控制。

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

`id`、`type`、`audience`、`visible` 和 `layout` 由核心管理，模块只负责 `data`。实例 ID 长 1～64，允许字母、数字、下划线和连字符；顺序由页面 `modules` 数组决定。服务端会移除实例层的未知字段。

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

`minWidth` 是舒适宽度，不是强制最小 CSS 宽度。容器比它更窄时仍占整行，模块仍须能够缩窄。窗口变化不会改写保存的尺寸偏好；排布保留用户顺序，按行换行，不做瀑布流或用后续模块回填空位。

### 模块拿到的容器

下图是核心提供的结构，供理解尺寸关系；模块不应修改或依赖这些外框类名来操纵页面：

```text
.module-slot                 宽度查询容器
├── 编辑工具 / 范围标签        只在相应编辑预览中出现
└── .module-frame            圆角外框；固定尺寸时为宽高查询容器
    └── .module-content      固定尺寸时可滚动
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

## 6. 可选的实时资源 `load({ request })`

`load()` 在浏览器调用已有的 JSON 接口，返回值经核心包装后作为 `render()` 第二个参数。它不运行在服务器，不能读取宿主机文件或秘密配置。

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

- 私人页和编辑台首次加载时请求，以后页面可见时约每 30 秒刷新；私人页也有手动刷新。
- 按使用中的**模块类型**调用一次 `load()`。同一类型的多个实例共享一个结果，不传实例 `data` 或 `id`。
- 同一刷新轮里，相同 `request()` 路由共享同一个请求，即使来自不同模块类型。
- 成功时 `resource` 是 `{ value: 返回值 }`；失败时是 `{ error: '状态暂时无法读取' }`；也可能尚未加载而是 `undefined`。
- 实际 Public 页面目前不调用 `load()`。编辑台的 Public 预览仍处于登录环境，不能据此判断公开访客是否能加载资源。

如果每张卡片需要按自己的配置请求不同数据，或公开页需要实时资源，应先扩展核心契约。不要用模块级变量保存“当前实例”来绕过按类型共享的机制。

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
```

`npm run check` 验证模块必需导出、默认数据、声明尺寸及初始页面；不会验证 CSS 是否存在、浏览器编辑控件或展示 HTML 是否安全。`npm test` 运行仓库的现有测试，新模块特有的字段和错误分支需要相应测试或实际验证。

在编辑台检查：

1. 添加同类型两个实例，编辑互不影响；保存后刷新仍保留内容和尺寸。
2. 拖动顺序、半行与整行宽度、120 像素最小高度、自动高度、窄屏和长文本，都可正常使用。
3. 输入 `< > & " '` 等字符按文字展示，超长、错误类型和非法链接在保存时被拒绝。
4. Public 发布后的匿名访问、Private 保存后的登录访问都符合预期；实时模块另外检查未采集、过期、请求失败和会话失效。

| 现象 | 优先检查 |
| --- | --- |
| 新模块不在添加列表 | 目录名和 `meta.id`、必需导出、是否已重启服务并刷新页面 |
| 服务器启动失败 | 默认数据、尺寸字段、已有草稿和发布内容是否通过新版本校验 |
| 提示模块暂时无法显示 / 编辑 | 浏览器中的导入、`render()`、`edit()` 错误；顶层 DOM 和 Node 专用依赖 |
| 样式没有生效 | `style.css` 路径、独立类名、浏览器网络请求；模块检查不验证 CSS |
| 卡片没有变窄 | `minWidth` 正在扩大占列数，或模块内部写死了宽度；检查实际容器尺寸 |
| 高度查询不起作用 | 当前是否为自动内容高度；高度查询需要手动高度或 `aspectRatio` |
| 保存后公开页没更新 | 普通修改需要发布；确认实例为 Public 且未隐藏 |
| 本地状态一直等待采集 | 本地未配置 `STATUS_FILE` / 状态采集，或文件不可读 |
| 公开页实时数据为空 | 当前 Public 不执行 `load()`，不要依赖编辑预览中的已登录结果 |
| 新字段保存后消失 | `validate()` 没有返回该字段，或把它误放在实例层而非 `data` 中 |

底层契约见 [`server/modules.js`](../server/modules.js)，浏览器调用方式见 [`web/app.js`](../web/app.js)。变更契约时应同时更新本手册和模板。
