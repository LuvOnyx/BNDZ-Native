/** Boot detection for `--plugin-window` second-process shells (mirrors stage open-path). */

export type PluginWindowBoot = {
  pluginId: string;
  stickyId?: string;
  title?: string;
};

export function readPluginWindowBootFromUrl(): PluginWindowBoot | null {
  try {
    const sp = new URLSearchParams(window.location.search);
    const pluginId = sp.get('pluginWindow') || sp.get('plugin-window');
    if (!pluginId) return null;
    const stickyId = sp.get('stickyId') || sp.get('sticky-id') || undefined;
    const title = sp.get('title') || undefined;
    return {
      pluginId,
      stickyId: stickyId || undefined,
      title: title || undefined,
    };
  } catch {
    return null;
  }
}

export function isStickyPluginMode(boot: PluginWindowBoot): boolean {
  return !!boot.stickyId || boot.pluginId === 'sticky-note';
}
