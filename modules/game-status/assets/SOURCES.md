# 游戏品牌素材来源

获取日期：2026-10-09。用于私人游戏状态模块的品牌识别；商标及美术版权属于对应游戏权利人，不属于 Mosaic 自制素材。

| 文件 | 官方来源 | 处理 |
| --- | --- | --- |
| `genshin-logo.png` | [原神官网](https://ys.mihoyo.com/main/) / [Logo 图片](https://ys.mihoyo.com/main/_nuxt/img/logo-header-full.a71d70a.png) | 原文件保存 |
| `arknights-logo.svg` | [明日方舟官网](https://ak.hypergryph.com/) 的 `svg_def-title_arknights` | 提取官方矢量路径；保留 viewBox，白色单色版 |
| `arknights-icon.svg` | [明日方舟官网](https://ak.hypergryph.com/) 的 `svg_def-logo_rhodes_island` | 提取罗德岛矢量标志，作为备用图标 |
| `endfield-logo.svg` | [终末地官网](https://endfield.hypergryph.com/) 中文语言配置的 SvgLogo / [官网脚本](https://web.hycdn.cn/endfield/official-v4/_next/static/chunks/app/%5Blang%5D/(main)/layout-f37c8a443b871dbe.js) | 提取官方矢量路径；保留 viewBox，白色单色版 |

SVG 为静态路径，无脚本、外部引用或事件。图片通过 `import.meta.url` 定位，与模块一起部署，支持站点路径前缀；加载失败仍保留中文游戏名。未使用账号头像。


## 状态卡 UI 素材

原神图标来自[米游社游戏记录页](https://webstatic.mihoyo.com/app/community-game-records/index.html)的实时便笺组件。按组件中的「原粹树脂」「探索派遣」「洞天财瓮」「每日委托奖励」文字与图片引用对应核对，原图保存：

| 本地文件 | 官方源文件 | 使用位置 |
| --- | --- | --- |
| `genshin-resin.png` | [logo-1.cd77560a.png](https://webstatic.mihoyo.com/app/community-game-records/images/logo-1.cd77560a.png) | 原粹树脂 |
| `genshin-expedition.png` | [UI_MarkPoint_Explore.639ceaf2.png](https://webstatic.mihoyo.com/app/community-game-records/images/UI_MarkPoint_Explore.639ceaf2.png) | 派遣完成 |
| `genshin-home.png` | [ys_home_icon.f2c6da2d.png](https://webstatic.mihoyo.com/app/community-game-records/images/ys_home_icon.f2c6da2d.png) | 洞天宝钱 |
| `genshin-task.png` | [ys_task_icon.8c6c8c3e.png](https://webstatic.mihoyo.com/app/community-game-records/images/ys_task_icon.8c6c8c3e.png) | 每日委托、委托奖励 |

以下资源取自 [FrostN0v0/nonebot-plugin-skland](https://github.com/FrostN0v0/nonebot-plugin-skland/tree/master/nonebot_plugin_skland/resources/images)，按同仓库 `ark_card.html.jinja2` 和 `endfield_card.html.jinja2` 的具体字段配对核对。它们是社区展示素材来源，不能据此宣称每张图片均由官方发布。上游 MIT 许可原文保留在 `SKLAND-ASSETS-LICENSE.txt`，游戏美术及商标仍归游戏权利人。

| 本地文件 | 上游相对路径 | 使用位置 |
| --- | --- | --- |
| `arknights-sanity.png` | `ark_card/card_img/ap.png` | 方舟理智；终末地体力沿用上游终末地状态卡的共用理智符号 |
| `arknights-daily.png` | `ark_card/card_img/daily.png` | 方舟每日任务 |
| `arknights-weekly.png` | `ark_card/card_img/weekly.png` | 方舟每周任务；终末地周任务沿用上游状态卡的共用日历符号 |
| `arknights-recruit.png` | `ark_card/card_img/hire.png` | 公招刷新 |
| `endfield-daily.png` | `endfield/daily.png` | 终末地每日活跃度 |
| `endfield-industries.svg` | `endfield/endfield-industries.svg` | 终末地工业标识水印 |

图片通过 CSS 等比缩放；单色素材在浅色主题下调整对比度。卡片的细边框、分隔线和斜纹为 Mosaic 自行排版，并非原游戏界面截图。图标使用空 alt，旁边保留完整文字；加载失败隐藏图片、保留字段和值。没有对应图标的新字段使用纯文字。
