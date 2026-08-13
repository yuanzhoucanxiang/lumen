import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * 生产环境 CSP(仅 build 注入;dev 模式的 React Refresh 内联 preamble 会被
 * script-src 'self' 拦截,故不注入)。
 * 渲染进程不发 fetch/XHR(全走 IPC),图片/媒体经 asset: 自定义协议加载。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React 内联 style 属性 + Tailwind
  "img-src 'self' asset: data: blob:",
  "media-src 'self' asset: blob:",
  "font-src 'self' data:",
  "connect-src 'self'"
].join('; ')

const injectCsp = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend'
    }
  ]
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss(), injectCsp()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
