/**
 * dsh-disable-unofficial-plugins —— 宿主半。
 *
 * 本插件的全部行为都在客户端半（`lib/client.js`）通过 DOM 注入实现：
 * 它复用宿主 `pluginManager` 服务的远程方法读取与切换组合包层，
 * 因此宿主半只需要给 profile 的 loader 提供一条可加载、可卸载的条目，
 * 不注册任何服务、不监听任何事件。
 */

/** 加载器条目名，与 package.json 的包名一致。 */
export const name = 'dsh-disable-unofficial-plugins'

/** 不依赖任何宿主服务。 */
export const inject = []

/** 无副作用。 */
export function apply() {}
