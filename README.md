# dsh-disable-unofficial-plugins

在 DeepSeek Harness「插件」页面的**「已安装」分组标题行最右侧**加一个 **停用全部非官方插件** 按钮，一次点击批量停用所有非官方插件。

> Adds a **Disable all unofficial plugins** button to the right end of the *Installed* group header on the DSH Plugins page. It disables every installed non-`@deepseek-ai/` bundle that can be disabled — disabling only, never uninstalling — and reports each failure with its reason.

## 它做什么

- 按钮固定在「已安装」分组标题行（`section[data-plugin-group="bundles"]`）最右侧，与该行的标题、计数垂直居中对齐；标题与计数节点的位置、整行行高都不变。
- 点击后先弹出确认框，显示**将被停用的插件数量与名单**。
- 确认后**串行**逐个停用，任何一项失败都不会中断其余插件。
- 结束后给出结果反馈：成功停用的数量、未成功项及其原因、以及「将在下次启动 DSH 后生效」的项数。
- **只停用，不卸载**：不删除插件文件，不删除插件配置数据，官方插件不受影响。

## 「非官方插件」的判定标准

以下条件同时成立才算「非官方插件」，才会被本按钮停用：

1. **不在内置组合包清单内**：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-acp-app`、`@deepseek-ai/dsh-sdk-minimal`；
2. **通过官方页「已安装」分组的同口径过滤**（已安装，或非可选），保证按钮的作用范围与它旁边那个计数一致；
3. **组合包名不以 `@deepseek-ai/` 开头**——DSH 安装自带的组合包全部发布在该作用域下，社区与第三方插件（含 `@michengai/`、`@liustack/` 等其它作用域）一律不在此列；
4. **不是本插件自身**，否则点一次按钮就把自己停掉了。

命中的插件再按可操作性三分：

| 分类 | 含义 | 处理 |
| --- | --- | --- |
| 可停用 | 当前启用、可经 profile 组合包层改动 | 本次停用 |
| 只读项 | 当前启用但带 `readOnlyReason`（官方托管、不可管理） | 跳过，并在确认框与结果里如实列出原因 |
| 已停用 | 非官方，但已经停用 | 计入总数，不重复操作 |

## 按钮何时不可用

没有可停用的非官方插件时按钮自动置灰，鼠标悬停给出具体原因：

- `非官方插件均已停用（共 N 个）`
- `没有可停用的非官方插件（N 个只读项无法停用）`
- `没有安装任何非官方插件`

按钮可用时，悬停提示为 `停用全部 N 个非官方插件（只停用，不卸载）`。

## 安装

```sh
dsh plugin --profile web add github:WhatCannotBeSaid/dsh-disable-unofficial-plugins
```

把 `web` 换成目标 profile 名（例如 `dsh-tui`）。安装后**重启 DSH**：客户端束只在模块图重新合成时才会更新，单纯刷新页面会命中旧缓存。

## 卸载

```sh
dsh plugin --profile web remove dsh-disable-unofficial-plugins
```

卸载会连带移除本插件自身，但**不会**把它停用过的那些插件重新启用。

## 实现说明

- 纯客户端插件，用原生 DOM 注入实现，不接管官方 React 树；宿主侧半无副作用（`inject = []`，`apply` 为空）。
- 所有数据读取与写操作都走宿主远程服务：`ctx.get('remote.pluginManager')` 的 `listBundles()` 与 `setBundleEnabled(name, false)`。注意远程命名空间是独立的 cordis 服务，服务名是点分形式 `remote.<namespace>`，因此**不能**写成 `ctx.get('remote').pluginManager`。
- 停用写的是 profile 的组合包层（`dsh.profile.bundles`），所以部分改动需要重启 DSH 才生效，结果反馈里会单独标出。
- 样式全部复用官方主题 token（`--dsw-*`），每个 token 都带兜底值，因此跟随当前主题。

## 版本

- **1.0.0** —— 首个版本。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
