import type { ElectronApi } from './index'

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
