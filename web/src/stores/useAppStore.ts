import { create } from 'zustand';
import { Project, getProjects, getProject, deleteProject } from '../lib/api';

interface AppState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;

  loadProjects: () => Promise<void>;
  loadProject: (id: string, silent?: boolean) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  clearCurrentProject: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await getProjects(1, 100); // 暂时获取前100个
      set({ projects: res.data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  loadProject: async (id: string, silent = false) => {
    if (!silent) set({ isLoading: true, error: null });
    try {
      const project = await getProject(id);
      set({ currentProject: project, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  removeProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await deleteProject(id);
      // 重新加载或本地过滤
      set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        isLoading: false
      }));
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  clearCurrentProject: () => set({ currentProject: null }),
}));

