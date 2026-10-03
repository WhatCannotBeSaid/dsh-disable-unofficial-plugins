/**
 * dsh-disable-unofficial-plugins —— 客户端半（Web）。
 *
 * 职责：在官方「插件」页「已安装」分组标题行的最右侧注入一个
 * 「停用全部非官方插件」按钮，一次点击停用全部非官方插件。
 *
 * 实现方式：纯原生 DOM 注入，不引入 React、不重绘官方 React 树。
 * 只在分组标题行（section[data-plugin-group="bundles"] > .groupHead）尾部追加
 * 一个自带 `margin-left:auto` + `align-self:center` 的独立节点，高度取标题行
 * 行高（.groupTitle 的 line-height:22px），因此原有 h3 / 计数 span 的位置与
 * 整行行高都不变。
 *
 * 数据与写操作全部走宿主远程服务 `ctx.remote.pluginManager`：
 *   listBundles():  Promise<RemoteResult<BundleInfo[]>>
 *   setBundleEnabled(name, enabled): Promise<RemoteResult<ChangeResult>>
 * 远程返回值统一为 { ok: true, value } | { ok: false, error: { code, message } }。
 */
window.__ModuleLoader__.load({
	id: 'dsh-disable-unofficial-plugins',
	factory: () => {
		/* ================================================================== *
		 * 一、判定口径与常量
		 * ================================================================== */

		/** 本插件自身的包名：批量停用时必须排除自己，否则点一次按钮就把自己停掉了。 */
		const SELF = 'dsh-disable-unofficial-plugins';

		/**
		 * 「非官方」的判据：**组合包名不以 `@deepseek-ai/` 开头**。
		 * DSH 安装自带的组合包全部发布在 `@deepseek-ai/` 作用域下；
		 * 社区 / 第三方插件（含 `@michengai/`、`@liustack/` 等其它作用域）一律不在此列。
		 */
		const OFFICIAL_SCOPE = '@deepseek-ai/';

		/** 官方页 renderGroup 的既有口径：这些内置组合包不进任何分组，本按钮也不涉及。 */
		const BUILTIN_PROFILE_BUNDLES = new Set([
			'@deepseek-ai/dsh-base',
			'@deepseek-ai/dsh-web-app',
			'@deepseek-ai/dsh-headless',
			'@deepseek-ai/dsh-sdk-app',
			'@deepseek-ai/dsh-acp-app',
			'@deepseek-ai/dsh-sdk-minimal'
		]);

		/** 「已安装」分组标题行：renderGroup 渲染为 section > .groupHead（h3 + 计数 span）。 */
		const GROUP_SELECTOR = 'section[data-plugin-group="bundles"]';
		const MARK = 'data-dsh-dup';
		const CSS_MARK = 'data-dsh-dup-css';

		const LABEL = '停用全部非官方插件';
		const SYNC_THROTTLE_MS = 150;
		/**
		 * 等待 `remote.pluginManager` 挂载的重试节奏。
		 *
		 * 宿主侧 `@deepseek-ai/dsh-api-remotes` 的客户端半 `inject = ["remote"]`，
		 * 其 apply 是 async 且依次 await 25 个 `ctx.remote.$mount(contribution)`；
		 * 本插件同样只 inject "remote" 而 apply 是同步的，因此必然在命名空间挂载完成
		 * **之前**就跑到 apply —— 那一刻 remote 已在、remote.pluginManager 还没挂上。
		 * 所以首次读取必定失败，必须靠这里的轮询等到它挂上来。
		 */
		const RETRY_INTERVAL_MS = 250;
		const RETRY_MAX = 120; // ≈30s，足够覆盖宿主异步挂载；超时后停手并保留错误提示

		/** 结果分类的展示元数据，键与 ChangeResult.application 对齐。 */
		const STATUS = {
			pending: { mark: '·', tone: 'idle', text: '等待中' },
			applied: { mark: '✓', tone: 'ok', text: '已停用' },
			restart: { mark: '✓', tone: 'ok', text: '已停用（重启后生效）' },
			overridden: { mark: '!', tone: 'warn', text: '未生效（被更高层覆盖）' },
			cancelled: { mark: '–', tone: 'idle', text: '已取消' },
			skipped: { mark: '–', tone: 'idle', text: '已跳过' },
			failed: { mark: '✕', tone: 'error', text: '失败' }
		};

		const CLOSE_ICON =
			'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
			'<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" ' +
			'stroke-width="1.4" stroke-linecap="round"/></svg>';

		/**
		 * 样式表。类名一律加 `dsh-dup-` 前缀；取值全部复用官方主题 token
		 * （尺寸与配色取自 @deepseek-ai/dsh-client-ui-primitives 的
		 * Button.module.css / Modal.module.css），每个 token 都带兜底值。
		 */
		const CSS = `
.dsh-dup-slot{margin-left:auto;align-self:center;display:inline-flex;flex:0 0 auto;box-sizing:border-box}
.dsh-dup-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:22px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-family:inherit;font-size:12px;font-weight:400;line-height:16px;white-space:nowrap;cursor:pointer;transition:background-color var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease)}
.dsh-dup-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}
.dsh-dup-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18))}
.dsh-dup-btn:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsh-dup-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px;box-sizing:border-box}
.dsh-dup-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35));backdrop-filter:var(--dsw-mask-blur)}
.dsh-dup-dialog{position:relative;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;width:min(380px,100%);max-height:100%;padding:0 0 24px;border-radius:var(--dsw-radius-panel,12px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);overflow:hidden}
.dsh-dup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsh-dup-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-dup-close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;box-sizing:border-box;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-dup-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dup-close:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-desc{margin:0;padding:0 24px;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary)}
.dsh-dup-body{display:flex;flex-direction:column;gap:12px;min-height:0;padding:0 24px;overflow:auto}
.dsh-dup-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsh-dup-desc[hidden],.dsh-dup-body[hidden],.dsh-dup-foot[hidden]{display:none}
.dsh-dup-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:400;line-height:22px;white-space:nowrap;cursor:pointer}
.dsh-dup-action.is-outline{border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35))}
.dsh-dup-action.is-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dup-action.is-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsh-dup-action.is-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3f5be8)}
.dsh-dup-action:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsh-dup-list{margin:0;padding:6px 8px;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:auto;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:var(--dsw-radius-sm,4px)}
.dsh-dup-list>li{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:20px}
.dsh-dup-mark{flex:0 0 auto;width:12px;text-align:center;font-size:12px;line-height:20px}
.dsh-dup-mark.is-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-dup-mark.is-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-dup-mark.is-error{color:var(--dsw-alias-state-error-primary)}
.dsh-dup-mark.is-idle{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-caption))}
.dsh-dup-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;color:var(--dsw-alias-label-primary)}
.dsh-dup-note{flex:0 0 auto;margin-left:auto;padding-left:8px;font-size:12px;line-height:20px;text-align:right;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.dsh-dup-note.is-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-dup-note.is-error{color:var(--dsw-alias-state-error-primary)}
.dsh-dup-sect{display:flex;flex-direction:column;gap:6px}
.dsh-dup-sect-title{margin:0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsh-dup-details{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-dup-details>summary{cursor:pointer;padding:2px 0}
.dsh-dup-hint{margin:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
`;

		/* ================================================================== *
		 * 二、模块状态
		 * ================================================================== */

		let ctxRef = null;
		let disposed = false;
		let styleEl = null;
		let slotEl = null;
		let btnEl = null;
		let observer = null;
		let unsubscribe = null;
		let syncTimer = null;
		let lastSyncAt = 0;
		let retryTimer = null;
		let retryCount = 0;
		let busy = false;
		let dialog = null;

		/** 最近一次读取到的组合包分类结果。 */
		let snapshot = { phase: 'loading', targets: [], blocked: [], off: [], error: null };

		/* ================================================================== *
		 * 三、远程服务访问
		 * ================================================================== */

		/**
		 * 探测远程服务此刻的真实状态：remote 本体、pluginManager 命名空间。
		 *
		 * 关键：`remote` 的命名空间**不是** `remote` 服务对象上的属性，而是各自独立的
		 * cordis 服务，服务名形如 `remote.<namespace>`。依据 api-gateway 客户端半
		 * （lib/client.js 第 2040 行）：
		 *   function remoteServiceKey(namespace) { return `remote.${namespace}`; }
		 * 它自己判重也用 `this.ownerCtx.get(serviceKey)`，并注明「install traced
		 * `remote.<namespace>` services; no JavaScript Proxy」。
		 * 所以 `ctx.get('remote').pluginManager` 恒为 undefined，必须用点分服务名
		 * `ctx.get('remote.pluginManager')`。
		 * 同款第三方先例：dsh-skill-mcp-panel/lib/client.js 用 ctx.get("remote.skillsViewer")。
		 * （官方插件页写 this.ctx.remote.pluginManager 能成立，是因为 cordis 的 `ctx.remote`
		 *   访问器会按点分名继续解析；而 ctx.get('remote') 拿到的只是基础服务本体。）
		 */
		function probeRemote() {
			if (!ctxRef) return { remote: undefined, pm: undefined };
			let remote;
			try {
				remote = ctxRef.get('remote');
			} catch (err) {
				remote = undefined;
			}
			let pm;
			try {
				pm = ctxRef.get('remote.pluginManager');
			} catch (err) {
				pm = undefined;
			}
			if (!pm) {
				// 兜底 1：万一某个外壳把命名空间挂成了基础服务上的属性。
				try {
					pm = remote ? remote.pluginManager : undefined;
				} catch (err) {
					pm = undefined;
				}
			}
			if (!pm) {
				// 兜底 2：cordis 访问器形式（官方插件页的写法 ctx.remote.pluginManager）。
				try {
					pm = ctxRef.remote ? ctxRef.remote.pluginManager : undefined;
				} catch (err) {
					pm = undefined;
				}
			}
			return { remote, pm };
		}

		function pluginManager() {
			return probeRemote().pm;
		}

		/** 未就绪时按缺在哪一层给出可定位的提示，而不是一句笼统的「不可用」。 */
		function notReadyText() {
			const { remote, pm } = probeRemote();
			if (!remote) return '插件管理服务未就绪（remote 服务不可用）';
			if (!pm) return '插件管理服务未就绪（remote 已在，remote.pluginManager 尚未挂载，正在等待）';
			return '插件管理服务未就绪（remote.pluginManager.listBundles 不可用）';
		}

		async function fetchBundles() {
			const pm = pluginManager();
			if (!pm || typeof pm.listBundles !== 'function') {
				throw new Error(notReadyText());
			}
			const answer = await pm.listBundles();
			if (!answer || answer.ok !== true) throw new Error(remoteErrorText(answer && answer.error, 'listBundles 调用失败'));
			return Array.isArray(answer.value) ? answer.value : [];
		}

		function remoteErrorText(error, fallback) {
			if (!error) return fallback;
			const parts = [];
			if (error.code) parts.push(String(error.code));
			if (error.message) parts.push(String(error.message));
			return parts.length > 0 ? parts.join('：') : fallback;
		}

		function changeErrorText(error, fallback) {
			if (!error) return fallback;
			const parts = [];
			if (error.code) parts.push(String(error.code));
			if (error.diagnostic) parts.push(String(error.diagnostic));
			if (Array.isArray(error.incompatible) && error.incompatible.length > 0) {
				parts.push(
					'不兼容：' +
						error.incompatible
							.map((item) => {
								if (!item) return '未知';
								const pkg = item.packageVersion || item.package || item.name || '?';
								const runtime = item.runtimeVersion || item.runtime || '?';
								return `${pkg}（运行时 ${runtime}）`;
							})
							.join('、')
				);
			}
			return parts.length > 0 ? parts.join('：') : fallback;
		}

		/* ================================================================== *
		 * 四、分类：谁算「非官方插件」
		 * ================================================================== */

		/**
		 * 与官方「已安装」分组同口径地筛出非官方组合包，再按可操作性三分：
		 *   targets —— 当前启用、可经 profile patch 改动，本次要停用的
		 *   blocked —— 当前启用但只读（readOnlyReason），停不了，跳过并如实汇报
		 *   off     —— 非官方但已经停用
		 * 「非官方」三条同时成立：
		 *   ① 不在 BUILTIN_PROFILE_BUNDLES 中；
		 *   ② 通过官方页 listed / mine 两道过滤（installed || optional || error；installed || !optional）；
		 *   ③ 包名不以 `@deepseek-ai/` 开头，且不是本插件自身。
		 */
		function classify(bundles) {
			const targets = [];
			const blocked = [];
			const off = [];
			for (const bundle of bundles) {
				if (!bundle || typeof bundle.name !== 'string') continue;
				if (BUILTIN_PROFILE_BUNDLES.has(bundle.name)) continue;
				if (!(bundle.installed || bundle.optional || bundle.error !== undefined)) continue;
				if (!(bundle.installed || !bundle.optional)) continue;
				if (bundle.name.startsWith(OFFICIAL_SCOPE)) continue;
				if (bundle.name === SELF) continue;
				if (!bundle.enabled) {
					off.push(bundle);
					continue;
				}
				if (bundle.readOnlyReason) {
					blocked.push(bundle);
					continue;
				}
				targets.push(bundle);
			}
			const byName = (a, b) => a.name.localeCompare(b.name);
			targets.sort(byName);
			blocked.sort(byName);
			off.sort(byName);
			return { targets, blocked, off };
		}

		async function reload() {
			try {
				const bundles = await fetchBundles();
				if (disposed) return;
				const parts = classify(bundles);
				snapshot = { phase: 'ready', error: null, targets: parts.targets, blocked: parts.blocked, off: parts.off };
				stopRetry();
			} catch (err) {
				if (disposed) return;
				snapshot = {
					phase: 'error',
					targets: [],
					blocked: [],
					off: [],
					error: err && err.message ? String(err.message) : String(err)
				};
				// 绝大多数情况下这里是「命名空间还没挂上来」而非真故障，自动重试直到就绪。
				startRetry();
			}
			render();
		}

		/** 轮询等待 remote.pluginManager 挂载；成功即停，超时即止。 */
		function startRetry() {
			if (disposed || retryTimer !== null || retryCount >= RETRY_MAX) return;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				retryCount += 1;
				if (disposed) return;
				void reload();
			}, RETRY_INTERVAL_MS);
		}

		function stopRetry() {
			if (retryTimer !== null) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
			retryCount = 0;
		}

		/* ================================================================== *
		 * 五、按钮：注入与状态
		 * ================================================================== */

		function installStyles() {
			if (document.querySelector('style[' + CSS_MARK + ']')) return;
			const style = document.createElement('style');
			style.setAttribute(CSS_MARK, '');
			style.textContent = CSS;
			document.head.appendChild(style);
			styleEl = style;
		}

		function sync() {
			if (disposed) return;
			const group = document.querySelector(GROUP_SELECTOR);
			const head = group ? group.firstElementChild : null;
			if (!head) {
				slotEl = null;
				btnEl = null;
				return;
			}
			if (slotEl && slotEl.isConnected && slotEl.parentElement === head) return;

			for (const stale of head.querySelectorAll(':scope > [' + MARK + ']')) stale.remove();

			const slot = document.createElement('span');
			slot.className = 'dsh-dup-slot';
			slot.setAttribute(MARK, '');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'dsh-dup-btn';
			button.textContent = LABEL;
			button.addEventListener('click', onClick);
			slot.appendChild(button);
			head.appendChild(slot);

			slotEl = slot;
			btnEl = button;
			render();
		}

		function schedule() {
			if (disposed || syncTimer !== null) return;
			const wait = Math.max(0, SYNC_THROTTLE_MS - (Date.now() - lastSyncAt));
			syncTimer = setTimeout(() => {
				syncTimer = null;
				lastSyncAt = Date.now();
				sync();
			}, wait);
		}

		function render() {
			if (!slotEl || !btnEl || !slotEl.isConnected) return;
			if (busy) {
				btnEl.disabled = true;
				slotEl.title = '正在停用非官方插件…';
				return;
			}
			const { phase, targets, blocked, off, error } = snapshot;
			if (phase === 'loading') {
				btnEl.disabled = true;
				slotEl.title = '正在读取插件列表…';
				return;
			}
			if (phase === 'error') {
				btnEl.disabled = true;
				const retrying = retryCount > 0 && retryCount < RETRY_MAX;
				slotEl.title = (error || '无法读取插件列表') + (retrying ? `（已重试 ${retryCount} 次，仍在等待服务就绪）` : '');
				return;
			}
			if (targets.length === 0) {
				btnEl.disabled = true;
				if (off.length > 0) slotEl.title = `非官方插件均已停用（共 ${off.length} 个）`;
				else if (blocked.length > 0) slotEl.title = `没有可停用的非官方插件（${blocked.length} 个只读项无法停用）`;
				else slotEl.title = '没有安装任何非官方插件';
				return;
			}
			btnEl.disabled = false;
			const extra = blocked.length > 0 ? `，另有 ${blocked.length} 个只读项会被跳过` : '';
			slotEl.title = `停用全部 ${targets.length} 个非官方插件（只停用，不卸载）${extra}`;
		}

		async function onClick() {
			if (busy || !btnEl) return;
			btnEl.disabled = true;
			await reload(); // 确认框里的数量必须是点击当下的
			if (disposed) return;
			if (snapshot.phase === 'error') {
				openMessageDialog('无法读取插件列表', snapshot.error || '未知错误');
				return;
			}
			if (snapshot.targets.length === 0) {
				render();
				return;
			}
			openConfirmDialog();
		}

		/* ================================================================== *
		 * 六、弹窗骨架
		 * ================================================================== */

		function el(tag, className, text) {
			const node = document.createElement(tag);
			if (className) node.className = className;
			if (text !== undefined) node.textContent = text;
			return node;
		}

		function mountDialog(options) {
			closeDialog();
			const previouslyFocused = document.activeElement;

			const root = el('div', 'dsh-dup-modal');
			root.setAttribute(MARK, '');
			const mask = el('div', 'dsh-dup-mask');
			const box = el('div', 'dsh-dup-dialog');
			box.setAttribute('role', 'dialog');
			box.setAttribute('aria-modal', 'true');

			const head = el('div', 'dsh-dup-head');
			const title = el('h2', 'dsh-dup-title', options.title || '');
			const closeBtn = el('button', 'dsh-dup-close');
			closeBtn.type = 'button';
			closeBtn.setAttribute('aria-label', '关闭');
			closeBtn.innerHTML = CLOSE_ICON;
			head.append(title, closeBtn);

			const desc = el('p', 'dsh-dup-desc');
			const body = el('div', 'dsh-dup-body');
			const foot = el('div', 'dsh-dup-foot');
			desc.hidden = true;
			body.hidden = true;
			foot.hidden = true;

			box.append(head, desc, body, foot);
			root.append(mask, box);
			document.body.appendChild(root);

			let dismissible = true;

			const api = {
				root,
				box,
				setTitle(text) {
					title.textContent = text;
				},
				setDescription(text) {
					desc.textContent = text || '';
					desc.hidden = !text;
				},
				setBody(...nodes) {
					body.replaceChildren(...nodes.filter(Boolean));
					body.hidden = body.childElementCount === 0;
				},
				setFooter(...nodes) {
					foot.replaceChildren(...nodes.filter(Boolean));
					foot.hidden = foot.childElementCount === 0;
				},
				/** 运行中把弹窗锁成不可关闭，避免中途 Esc / 点遮罩把进度界面弄丢。 */
				lock() {
					dismissible = false;
					closeBtn.disabled = true;
				},
				unlock() {
					dismissible = true;
					closeBtn.disabled = false;
				},
				requestClose() {
					if (dismissible) closeDialog();
				}
			};

			const dismiss = () => api.requestClose();
			closeBtn.addEventListener('click', dismiss);
			mask.addEventListener('mousedown', (event) => {
				if (event.target === mask) dismiss();
			});
			const onEscape = (event) => {
				if (event.key === 'Escape') {
					event.stopPropagation();
					dismiss();
				}
			};
			document.addEventListener('keydown', onEscape, true);

			dialog = {
				api,
				previouslyFocused,
				onEscape,
				focusFirst() {
					const target =
						foot.querySelector('.dsh-dup-action.is-primary:not(:disabled)') ||
						foot.querySelector('.dsh-dup-action:not(:disabled)') ||
						closeBtn;
					if (target && typeof target.focus === 'function') target.focus();
				}
			};
			return api;
		}

		function closeDialog() {
			if (!dialog) return;
			document.removeEventListener('keydown', dialog.onEscape, true);
			dialog.api.root.remove();
			const previous = dialog.previouslyFocused;
			dialog = null;
			if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
		}

		/* ================================================================== *
		 * 七、弹窗内容
		 * ================================================================== */

		function actionButton(label, variant, onClick) {
			const button = el('button', 'dsh-dup-action ' + variant, label);
			button.type = 'button';
			button.addEventListener('click', onClick);
			return button;
		}

		function nameList(entries) {
			const list = el('ul', 'dsh-dup-list');
			for (const entry of entries) {
				const meta = STATUS[entry.status] || STATUS.pending;
				const item = el('li');
				item.appendChild(el('span', 'dsh-dup-mark is-' + meta.tone, meta.mark));
				item.appendChild(el('span', 'dsh-dup-name', entry.name));
				const note = entry.note === undefined || entry.note === '' ? meta.text : entry.note;
				if (note) {
					const tone = meta.tone === 'error' ? ' is-error' : meta.tone === 'warn' ? ' is-warn' : '';
					item.appendChild(el('span', 'dsh-dup-note' + tone, note));
				}
				list.appendChild(item);
			}
			return list;
		}

		function sect(titleText, ...nodes) {
			const wrap = el('div', 'dsh-dup-sect');
			wrap.appendChild(el('h3', 'dsh-dup-sect-title', titleText));
			for (const node of nodes) if (node) wrap.appendChild(node);
			return wrap;
		}

		function openMessageDialog(titleText, message) {
			const api = mountDialog({ title: titleText });
			api.setDescription(message);
			api.setFooter(actionButton('关闭', 'is-primary', () => closeDialog()));
			dialog.focusFirst();
		}

		function openConfirmDialog() {
			const targets = snapshot.targets.slice();
			const blocked = snapshot.blocked.slice();
			const api = mountDialog({ title: '停用全部非官方插件' });
			api.setDescription(
				`将停用 ${targets.length} 个非官方插件。只从当前生效的组合包层中移除，` +
					'不会卸载插件、不会删除插件文件与配置数据；官方插件不受影响。'
			);
			const bodyNodes = [nameList(targets.map((bundle) => ({ name: bundle.name, status: 'pending' })))];
			if (blocked.length > 0) {
				const reasons = blocked
					.map((bundle) => bundle.readOnlyReason)
					.filter((reason, index, all) => all.indexOf(reason) === index)
					.join('、');
				bodyNodes.push(el('p', 'dsh-dup-hint', `另有 ${blocked.length} 个非官方插件为只读项（${reasons}），无法停用，将跳过。`));
			}
			bodyNodes.push(el('p', 'dsh-dup-hint', `本插件自身（${SELF}）不在停用范围内。`));
			api.setBody(...bodyNodes);
			api.setFooter(
				actionButton('取消', 'is-outline', () => closeDialog()),
				actionButton(`停用 ${targets.length} 个插件`, 'is-primary', () => {
					void run(targets, blocked);
				})
			);
			dialog.focusFirst();
		}

		/* ================================================================== *
		 * 八、批量停用
		 * ================================================================== */

		async function run(targets, blocked) {
			if (busy || !dialog) return;
			busy = true;
			const api = dialog.api;
			api.lock();
			render();

			const items = targets.map((bundle) => ({ name: bundle.name, status: 'pending', note: '' }));
			const draw = (done) => {
				if (disposed) return;
				api.setTitle('正在停用非官方插件');
				api.setDescription(`正在停用…（${done} / ${items.length}）`);
				api.setBody(nameList(items));
				api.setFooter();
			};
			draw(0);

			const pm = pluginManager();
			for (let index = 0; index < items.length; index += 1) {
				if (disposed) break;
				const item = items[index];
				try {
					// 串行执行：setBundleEnabled 要写 profile 文件，并发会互相竞争。
					const answer = pm ? await pm.setBundleEnabled(item.name, false) : undefined;
					if (!answer || answer.ok !== true) {
						item.status = 'failed';
						item.note = remoteErrorText(answer && answer.error, '调用失败');
					} else {
						const result = answer.value || {};
						switch (result.application) {
							case 'failed':
								item.status = 'failed';
								item.note = changeErrorText(result.error, '停用失败');
								break;
							case 'cancelled':
								item.status = 'cancelled';
								item.note = '操作被取消';
								break;
							case 'overridden':
								item.status = 'overridden';
								item.note = '被更高优先级的层覆盖，未生效';
								break;
							case 'restart-required':
								item.status = 'restart';
								item.note = '重启 DSH 后生效';
								break;
							default:
								item.status = 'applied';
								item.note = '';
								break;
						}
					}
				} catch (err) {
					// 单项失败绝不中断循环，其余插件继续处理。
					item.status = 'failed';
					item.note = err && err.message ? String(err.message) : String(err);
				}
				draw(index + 1);
			}

			busy = false;
			await reload(); // 刷新按钮自身的可用状态
			renderResult(items, blocked);
		}

		function renderResult(items, blocked) {
			if (!dialog) return;
			const succeeded = items.filter((item) => item.status === 'applied' || item.status === 'restart');
			const restarted = items.filter((item) => item.status === 'restart');
			const failed = items.filter(
				(item) => item.status === 'failed' || item.status === 'overridden' || item.status === 'cancelled'
			);

			dialog.api.setTitle(failed.length === 0 ? '停用完成' : '停用完成（部分未成功）');
			let summary = `成功停用 ${succeeded.length} 个非官方插件`;
			if (failed.length > 0) summary += `；${failed.length} 个未成功`;
			if (blocked.length > 0) summary += `；跳过 ${blocked.length} 个只读项`;
			summary += '。';
			if (restarted.length > 0) summary += `其中 ${restarted.length} 个将在下次启动 DSH 后生效。`;
			dialog.api.setDescription(summary);

			const nodes = [];
			if (failed.length > 0) nodes.push(sect(`未成功（${failed.length}）`, nameList(failed)));
			if (blocked.length > 0) {
				nodes.push(
					sect(
						`已跳过（${blocked.length}）`,
						nameList(
							blocked.map((bundle) => ({
								name: bundle.name,
								status: 'skipped',
								note: `只读：${bundle.readOnlyReason}`
							}))
						)
					)
				);
			}
			if (succeeded.length > 0) {
				const details = el('details', 'dsh-dup-details');
				details.appendChild(el('summary', undefined, `已停用（${succeeded.length}）`));
				details.appendChild(nameList(succeeded));
				nodes.push(details);
			}
			if (nodes.length === 0) nodes.push(el('p', 'dsh-dup-hint', '没有任何改动。'));
			dialog.api.setBody(...nodes);
			dialog.api.unlock();
			dialog.api.setFooter(actionButton('关闭', 'is-primary', () => closeDialog()));
			dialog.focusFirst();
		}

		/* ================================================================== *
		 * 九、生命周期
		 * ================================================================== */

		function dispose() {
			disposed = true;
			if (syncTimer !== null) {
				clearTimeout(syncTimer);
				syncTimer = null;
			}
			stopRetry();
			if (observer) {
				observer.disconnect();
				observer = null;
			}
			if (typeof unsubscribe === 'function') {
				try {
					unsubscribe();
				} catch (err) {
					/* 退订失败无需上报 */
				}
				unsubscribe = null;
			}
			closeDialog();
			if (slotEl) {
				slotEl.remove();
				slotEl = null;
			}
			btnEl = null;
			if (styleEl) {
				styleEl.remove();
				styleEl = null;
			}
		}

		function apply(ctx) {
			disposed = false;
			ctxRef = ctx;
			installStyles();

			if (typeof ctx.effect === 'function') ctx.effect(() => dispose);

			const remote = ctx.get('remote');
			if (remote && typeof remote.$on === 'function') {
				try {
					const off = remote.$on('plugin-manager/changed', () => {
						if (!busy) void reload();
					});
					if (typeof off === 'function') unsubscribe = off;
				} catch (err) {
					/* 订阅失败不影响按钮本身 */
				}
			}

			observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true });

			sync();
			void reload();
		}

		return { name: SELF, apply, inject: ['remote'] };
	}
});
