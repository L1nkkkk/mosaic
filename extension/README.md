# Mosaic Browser 扩展

让 Mosaic 的「浏览器」模块能在卡片里打开网站。它只在你填写的 Mosaic 地址下生效，其他标签页的行为不变。

[返回 README](../README.md) · [模块开发手册](../docs/MODULES.md)

## 安装

需要 Chrome 或 Edge 111 及以上。

1. 取得本目录：克隆仓库，或下载后解压。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择这个 `extension/` 目录。
4. 点击工具栏里的扩展图标，填入自己的 Mosaic 地址并保存，例如 `https://example.com/mosaic`。部署在子路径时要带上前缀。
5. 刷新 Mosaic 私人页，在编辑台添加「浏览器」模块并保存。

更新代码后，在扩展管理页点击这个扩展的「重新加载」。

## 它做了什么

| 行为 | 范围 |
| --- | --- |
| 移除响应头 `X-Frame-Options` 和 `Content-Security-Policy` | 只针对顶层页面是 Mosaic 的标签页里的子框架 |
| 把 Cookie 改写为 `SameSite=None; Secure` | 只针对在模块里打开过的网站 |
| 补存框架内响应和脚本写入的 Cookie | 只针对 Mosaic 标签页 |
| 把「新标签页打开」的链接和 `window.open` 留在框架内 | 只针对直接嵌在 Mosaic 页面里的那一层框架 |
| 向 Mosaic 页面上报框架当前地址和标题 | 同上 |

扩展不收集数据，不联网，不包含远程代码；Mosaic 地址保存在浏览器的扩展同步存储里。

## 需要知道的代价

- **Cookie 的跨站防护会变弱。** Chrome 默认不把没有声明 `SameSite=None` 的 Cookie 发给跨站框架，登录状态因此进不了模块。扩展把这些网站的 Cookie 改成了 `SameSite=None`，其他网站向它们发起的跨站请求也会带上 Cookie。只建议在模块里打开你信任、且自身有 CSRF 防护的网站。
- **被嵌入页面自己的 CSP 被一并移除。** 声明式规则只能删除整个响应头，无法只去掉 `frame-ancestors`。
- **需要允许第三方 Cookie。** 在无痕窗口或开启了「阻止第三方 Cookie」时，框架内拿不到登录状态，需要为 Mosaic 站点添加例外。
- 框架内的 `localStorage` 按顶层站点分区，与普通标签页里的同一网站不共享，播放器偏好等需要在模块里另设一次。
- 用脚本检测自己是否被嵌入并拒绝显示的网站仍然打不开；用模块右上角的 ↗ 在新标签页打开。

## 权限

- `<all_urls>`：模块是通用浏览器，任何 HTTPS 网站都可能被打开。
- `declarativeNetRequest`：移除上面两个响应头。
- `webRequest`：只读，用来看到框架内响应设置的 Cookie。
- `cookies`、`storage`：改写 Cookie，保存 Mosaic 地址。

## 文件

- `core.js`：地址匹配、规则生成和 Cookie 换算，纯函数，由 `test/extension.test.js` 覆盖。
- `background.js`：维护会话规则、改写和补存 Cookie。
- `content-top.js`：在 Mosaic 页面写入 `data-mosaic-browser` 标记。
- `content-frame.js`、`content-frame-main.js`：框架内的地址上报与链接处理。
- `options.*`：设置页。
