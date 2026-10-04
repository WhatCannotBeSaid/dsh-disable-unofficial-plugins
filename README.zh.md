# dsh-disable-unofficial-plugins

[English](README.md) | 中文

在 DeepSeek Harness「插件」页面的**「已安装」分组标题行最右侧**加一个 **停用非官方插件…** 按钮：点开后勾选要停用哪些非官方插件（默认全选），确认后批量停用。全部停用之后，按钮自己翻成 **启用非官方插件…**，同一套勾选清单可以把它们再启用回来。

> **关于语言**：本文件是中文说明，英文版见 [README.md](README.md)。本插件注入到「插件」页的文案跟随软件语言（**设置 → 通用 → 语言**）：它向宿主 locale 服务注册中英两套字典，切换语言时立即重画按钮、打开着的弹窗与结果反馈。下文中的界面文案按中文引用，括号里给出英文原文。

## 它做什么

- 按钮固定在「已安装」分组标题行（`section[data-plugin-group="bundles"]`）最右侧，与该行的标题、计数垂直居中对齐；标题与计数节点的位置、整行行高都不变。
- 点击后先弹出确认框，里面是**勾选清单**：按钮在停用侧时列当前**已启用**的非官方插件，翻到启用侧后列当前**已停用**的。
- **默认全选**，所以「一次全停」仍然是点两下（按钮 + 确认）；取消勾选就能只动其中几个。工具栏带「全选 / 全不选」（Select all / Select none）与实时计数 `已选 N / M`（`N of M selected`），主按钮文案跟着勾选变（如 `停用 17 个插件` / `Disable 17 plugins`）；一个都没勾时主按钮置灰，点了不执行。
- 确认后**串行**逐个切换，任何一项失败都不会中断其余插件。
- 结束后给出结果反馈：成功数量、未成功项、跳过的只读项，以及「将在下次启动 DSH 后生效」的项数。
- 失败项**行内只显示错误码**，完整诊断收进该行的**「完整诊断」（Full diagnostics）折叠区**（默认收起）——长诊断不会把同一行的包名挤变形。
- **只停用 / 只启用，不卸载**：不删除插件文件，不删除插件配置数据，官方插件不受影响。

## 「非官方插件」的判定标准

以下条件同时成立才算「非官方插件」，才会出现在勾选清单里：

1. **不在内置组合包清单内**：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-acp-app`、`@deepseek-ai/dsh-sdk-minimal`；
2. **通过官方页「已安装」分组的同口径过滤**（已安装，或非可选），保证按钮的作用范围与它旁边那个计数一致；
3. **组合包名不以 `@deepseek-ai/` 开头**——DSH 安装自带的组合包全部发布在该作用域下，社区与第三方插件（含 `@michengai/`、`@liustack/` 等其它作用域）一律不在此列；
4. **不是本插件自身**，否则点一次按钮就把自己停掉了。

命中的插件再按可操作性三分：

| 分类 | 含义 | 处理 |
| --- | --- | --- |
| 可停用 | 当前启用、可经 profile 组合包层改动 | 出现在**停用侧**的勾选清单里 |
| 可启用 | 非官方，但已经停用 | 全部停用后出现在**启用侧**的勾选清单里 |
| 只读项 | 带 `readOnlyReason`（官方托管、不可管理） | 两个方向都不收它，在确认框与结果里如实列出原因 |

## 按钮何时不可用

按钮自动置灰，鼠标悬停给出具体原因：

- `没有可切换的非官方插件（N 个只读项既停不了也启用不了）`（No switchable unofficial plugins (N read-only entries can be neither disabled nor enabled)）
- `没有安装任何非官方插件`（No unofficial plugins are installed）
- `正在读取插件列表…`、`正在停用非官方插件…`（Reading the plugin list… / Disabling unofficial plugins…，读取中与执行中）
- `插件管理服务未就绪（remote 已在，remote.pluginManager 尚未挂载，正在等待）`（The plugin management service is not ready (remote is present, remote.pluginManager is not mounted yet; waiting)）—— 宿主远程服务晚于页面挂载时先置灰并自动重试，就绪后自行恢复

按钮可用时的悬停提示：

- `选择要停用的非官方插件（共 N 个可停用，只停用不卸载）`（Choose the unofficial plugins to disable (N can be disabled; disable only, never uninstall)）
- `选择要启用的非官方插件（共 N 个可启用，只启用不安装）`（Choose the unofficial plugins to enable (N can be enabled; enable only, never install)）
- 存在只读项时追加 `，另有 N 个只读项会被跳过`（`; N read-only entries will be skipped`）

## 安装

```sh
dsh plugin --profile web add github:WhatCannotBeSaid/dsh-disable-unofficial-plugins
```

把 `web` 换成目标 profile 名（例如 `dsh-tui`）。安装后**重启 DSH**：客户端束只在模块图重新合成时才会更新，单纯刷新页面会命中旧缓存。

## 卸载

```sh
dsh plugin --profile web remove dsh-disable-unofficial-plugins
```

卸载会连带移除本插件自身，但**不会**把它停用过的那些插件重新启用，也**不会**把它启用过的插件停回去。

## 实现说明

- 纯客户端插件，用原生 DOM 注入实现，不接管官方 React 树；宿主侧半无副作用（`inject = []`，`apply` 为空）。
- 所有数据读取与写操作都走宿主远程服务：`ctx.get('remote.pluginManager')` 的 `listBundles()` 与 `setBundleEnabled(name, enabled)`。注意远程命名空间是独立的 cordis 服务，服务名是点分形式 `remote.<namespace>`，因此**不能**写成 `ctx.get('remote').pluginManager`。
- 切换写的是 profile 的组合包层（`dsh.profile.bundles`），所以部分改动需要重启 DSH 才生效，结果反馈里会单独标出。
- 勾选状态只活在弹窗 DOM 上，不额外维护一份 JS 副本，避免两边不同步。
- 样式全部复用官方主题 token（`--dsw-*`），每个 token 都带兜底值，因此跟随当前主题。

## 语言

- 注入文案跟随软件语言：客户端半 `inject = ['remote', 'locale']`，包级 `dsh.client.inject` 同步声明对应的客户端模块（`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-locale`）。用自己的 `disableUnofficialPlugins` 命名空间向官方 locale 服务注册 `{ zh, en }` 两套字典（`ctx.locale.register` + `ctx.locale.bind`）；宿主半仍无副作用（`inject = []`）。
- 订阅语言变化后按需重画：按钮、悬停提示、以及当前打开着的弹窗。弹窗是**原地重填**（标题 / 描述 / 正文 / 页脚分别替换），不重建节点，所以在弹窗开着时换语言不会丢掉勾选状态，也不会打断正在跑的执行。
- `cancel` / `close` 两个词**不**写进本插件的字典，直接用 locale 服务自带 `common` 命名空间的译文，宿主换词即刻生效。
- 宿主完全没有 locale 服务时退回浏览器语言（与 DSH 同规则：既不是中文也不是英文时用英文）。

## 版本

- **1.2.0** —— 注入文案跟随软件语言：向宿主 locale 服务注册中英两套字典，在「设置 → 通用 → 语言」切换时连打开着的弹窗一起实时重画。
- **1.1.0** —— 按钮改成勾选清单，可以选择停用/启用哪些插件（默认全选）；全部停用后按钮翻转为启用侧；失败项行内只显示错误码，完整诊断收进折叠区。
- **1.0.0** —— 首个版本：一键停用全部非官方插件。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
