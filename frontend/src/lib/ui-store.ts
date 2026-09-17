import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  rightPanelOpen: boolean
  commandPaletteOpen: boolean
  searchFocusToken: number
  toggleSidebar: () => void
  toggleRightPanel: () => void
  setCommandPaletteOpen: (open: boolean) => void
  focusSearch: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: false,
  commandPaletteOpen: false,
  searchFocusToken: 0,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  focusSearch: () => set((s) => ({ searchFocusToken: s.searchFocusToken + 1 })),
}))
