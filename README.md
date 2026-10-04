# dsh-disable-unofficial-plugins

English | [中文](README.zh.md)

> Adds a **Disable unofficial plugins…** button to the right end of the *Installed* group header on the DSH Plugins page. It opens a checklist of the unofficial plugins in the current direction — all checked by default — and toggles only the ones you leave checked; once everything is disabled the button flips to **Enable unofficial plugins…**. Disabling and enabling only: it never uninstalls a plugin and never deletes plugin files or configuration data.

> **Note on language.** This file is the English documentation; the Chinese original is [README.zh.md](README.zh.md). The copy this plugin injects into the Plugins page follows the software language (**Settings → General → Language**): it registers a Chinese and an English dictionary with the host locale service and repaints itself — button, open dialog and result report — the moment you switch. Strings below are quoted in English, with the Chinese original in parentheses.

## What it does

- The button is pinned to the right end of the *Installed* group header (`section[data-plugin-group="bundles"]`), vertically centered with that row's title and count; the title and count nodes keep their positions and the row keeps its height.
- Clicking it first opens a confirm dialog holding a **checklist**: with the button on the disable side it lists the unofficial plugins that are currently **enabled**; once flipped to the enable side it lists the ones that are currently **disabled**.
- **Everything is checked by default**, so "disable them all in one go" is still two clicks (button + confirm); uncheck the ones you want to keep and only the rest are toggled. The toolbar carries Select all / Select none (`全选` / `全不选` in Chinese) and a live counter `N of M selected` (`已选 N / M`), and the primary button label follows the selection (e.g. `Disable 17 plugins` / `停用 17 个插件`); with nothing checked the primary button is greyed out and does nothing when clicked.
- After you confirm, the plugins are toggled **serially**, one at a time; a failure on any single item never interrupts the rest.
- When it finishes you get a result report: how many succeeded, which ones did not succeed, the read-only entries that were skipped, and how many items will only take effect after the next DSH launch.
- A failed row shows **only the error code inline**; the full diagnostic goes into that row's **`Full diagnostics`** (`完整诊断`) collapsible area, collapsed by default — a long diagnostic will not distort the package name on the same row.
- **Disable / enable only, never uninstall**: no plugin file is deleted, no plugin configuration data is deleted, and official plugins are unaffected.

## What counts as an "unofficial plugin"

A plugin enters the checklist only when all of the following hold:

1. **It is not one of the built-in bundles**: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`, `@deepseek-ai/dsh-sdk-app`, `@deepseek-ai/dsh-acp-app`, `@deepseek-ai/dsh-sdk-minimal`;
2. **It passes the same filter as the official Plugins page's *Installed* group** (installed, or not optional), which keeps the button's scope identical to the count next to it;
3. **Its bundle name does not start with `@deepseek-ai/`** — every bundle shipped with a DSH install is published under that scope, so community and third-party plugins (including other scopes such as `@michengai/` and `@liustack/`) all fall outside it;
4. **It is not this plugin itself**, or one click of the button would disable the button.

Matching plugins are then split three ways by what can actually be done to them:

| Class | Meaning | Handling |
| --- | --- | --- |
| Disableable | Currently enabled and changeable through the profile bundle layer | Listed in the **disable side** checklist |
| Enableable | Unofficial, but already disabled | Listed in the **enable side** checklist once everything is disabled |
| Read-only | Carries a `readOnlyReason` (officially managed, not manageable) | Excluded from both directions, with the reason reported honestly in the confirm dialog and in the result |

## When the button is unavailable

The button greys itself out and gives the specific reason on hover:

- `No switchable unofficial plugins (N read-only entries can be neither disabled nor enabled)` — `没有可切换的非官方插件（N 个只读项既停不了也启用不了）`
- `No unofficial plugins are installed` — `没有安装任何非官方插件`
- `Reading the plugin list…` / `Disabling unofficial plugins…` — `正在读取插件列表…` / `正在停用非官方插件…` (while reading and while running)
- `The plugin management service is not ready (remote is present, remote.pluginManager is not mounted yet; waiting)` — `插件管理服务未就绪（remote 已在，remote.pluginManager 尚未挂载，正在等待）`. When the host remote service mounts later than the page, the button greys out, retries automatically, and recovers by itself once the service is ready.

Hover hints while the button is usable:

- `Choose the unofficial plugins to disable (N can be disabled; disable only, never uninstall)` — `选择要停用的非官方插件（共 N 个可停用，只停用不卸载）`
- `Choose the unofficial plugins to enable (N can be enabled; enable only, never install)` — `选择要启用的非官方插件（共 N 个可启用，只启用不安装）`
- when read-only entries exist, `; N read-only entries will be skipped` is appended — `，另有 N 个只读项会被跳过`

## Install

```sh
dsh plugin --profile web add github:WhatCannotBeSaid/dsh-disable-unofficial-plugins
```

Replace `web` with the target profile name (for example `dsh-tui`). **Restart DSH after installing**: the client bundle is only refreshed when the module graph is recomposed, so a plain page refresh hits the old cache.

## Uninstall

```sh
dsh plugin --profile web remove dsh-disable-unofficial-plugins
```

Uninstalling removes this plugin itself, but it does **not** re-enable the plugins it disabled, and does **not** disable the plugins it enabled.

## Implementation notes

- A pure client-side plugin, injected with plain DOM; it never takes over the official React tree. The host half is effectively side-effect free (`inject = []`, empty `apply`).
- All data reads and writes go through the host remote service: `listBundles()` and `setBundleEnabled(name, enabled)` on `ctx.get('remote.pluginManager')`. Note that the remote namespaces are separate cordis services named in dotted form `remote.<namespace>`, so `ctx.get('remote').pluginManager` **cannot** be used.
- Toggling writes to the profile's bundle layer (`dsh.profile.bundles`), so some changes only take effect after restarting DSH; the result report calls those items out separately.
- Checkbox state lives only in the dialog DOM — no second JS copy is kept, so the two can never drift apart.
- All styling reuses official theme tokens (`--dsw-*`), each with a fallback value, so it follows the current theme.

## Language

- The injected copy follows the software language. The client half is gated on `inject = ['remote', 'locale']`, and its package declares the matching client modules in `dsh.client.inject` (`@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-locale`). It registers its own `disableUnofficialPlugins` namespace as a `{ zh, en }` dictionary with the official locale service (`ctx.locale.register` + `ctx.locale.bind`); the host half stays side-effect free (`inject = []`).
- It subscribes to locale changes and repaints whatever is on screen: the button, its hover hint, and any dialog that is currently open. Dialogs are painted in place (title / description / body / footer are re-filled), never rebuilt, so switching language mid-dialog keeps your checkbox selection and the run in progress.
- `cancel` / `close` are **not** duplicated in this plugin's dictionary — they come from the locale service's own `common` namespace, so every host-provided translation of those two words is picked up at once.
- On a host with no locale service at all, it falls back to the browser language (matching DSH's own rule: anything that is neither Chinese nor English becomes English).

## Versions

- **1.2.0** — the injected copy follows the software language: a Chinese and an English dictionary registered with the host locale service, repainted live — including an open dialog — when you switch language in Settings → General → Language.
- **1.1.0** — the button becomes a checklist, so you choose which plugins to disable/enable (all checked by default); once everything is disabled the button flips to the enable side; a failed row shows only the error code inline, with the full diagnostic moved into a collapsible area.
- **1.0.0** — first release: one-click disable of every unofficial plugin.

## License

MIT, see [LICENSE](./LICENSE).
