/** Types for the vendored oatis-style vivi-cloud.js, which registers `window.ViviCloud`. */
export type ViviState = 'idle' | 'talk' | 'think' | 'sleep' | 'annoyed' | 'happy' | 'glitch'

export interface ViviInstance {
  setState(state: ViviState): ViviInstance
  setVolume(volume: number | null): ViviInstance
  surprise(): ViviInstance
  poke(x: number, y: number): ViviInstance
  destroy(): void
}

export interface ViviCloudApi {
  create(
    canvas: HTMLCanvasElement,
    options?: {
      size?: number
      state?: ViviState
      theme?: 'auto' | 'dark' | 'light'
      transparent?: boolean
      interactive?: boolean
      seed?: number
    },
  ): ViviInstance
}

declare global {
  interface Window {
    ViviCloud?: ViviCloudApi
  }
}
