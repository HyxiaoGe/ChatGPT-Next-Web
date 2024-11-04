import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";

export type Plugin = {
  id: string;
  createdAt: number;
  title: string;
  version: string;
  content: string;
  builtin: boolean;
};

const DEFAULT_PLUGINS: Record<string, Plugin> = {
  'simple-chat': {
    id: 'simple-chat',
    title: '简单对话',
    version: '1.0.0',
    content: '',
    builtin: true,
    createdAt: Date.now(),
  },
  'file-chat': {
    id: 'file-chat',
    title: '文件对话',
    version: '1.0.0',
    content: '',
    builtin: true,
    createdAt: Date.now(),
  },
  'knowledge-chat': {
    id: 'knowledge-chat',
    title: '知识库对话',
    version: '1.0.0',
    content: '',
    builtin: true,
    createdAt: Date.now(),
  }
};

export const DEFAULT_PLUGIN_STATE = {
  plugins: DEFAULT_PLUGINS
};

export const usePluginStore = createPersistStore(
    DEFAULT_PLUGIN_STATE,
    (set, get) => ({
      create() {
        try {
          const state = get();
          const currentPlugins = (state && state.plugins) ? state.plugins : {};

          // 如果没有插件才初始化默认插件
          if (Object.keys(currentPlugins).length === 0) {
            set({ plugins: DEFAULT_PLUGINS });
            return DEFAULT_PLUGINS;
          }

          return currentPlugins;
        } catch (e) {
          console.error("Error in create:", e);
          return DEFAULT_PLUGINS;
        }
      },

      updatePlugin(id: string, updater: (plugin: Plugin) => void) {
        const state = get();
        const plugins = (state && state.plugins) ? state.plugins : {};
        const plugin = plugins[id];
        if (!plugin) return;
        const updatePlugin = { ...plugin };
        updater(updatePlugin);
        plugins[id] = updatePlugin;
        set({ plugins });
      },

      delete(id: string) {
        const state = get();
        const plugins = (state && state.plugins) ? state.plugins : {};
        delete plugins[id];
        set({ plugins });
      },

      get(id?: string) {
        const state = get();
        const plugins = (state && state.plugins) ? state.plugins : {};
        return plugins[id || 'simple-chat'] || null;
      },

      getAll() {
        const state = get();
        const plugins = (state && state.plugins) ? state.plugins : {};
        return Object.values(plugins).sort(
            (a, b) => b.createdAt - a.createdAt,
        );
      },
    }),
    {
      name: StoreKey.Plugin,
      version: 1,
      onRehydrateStorage(state) {
        if (typeof window === "undefined") return;

        try {
          state.create();
        } catch (e) {
          console.error("Error in onRehydrateStorage:", e);
        }
      },
    },
);