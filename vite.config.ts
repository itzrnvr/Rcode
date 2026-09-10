import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        preview: resolve(__dirname, "preview.html"),
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/ipc": { target: "http://127.0.0.1:5174", changeOrigin: true },
      "/api/events": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
        // Keep SSE frames flowing through Vite in development.
        configure: proxy => { proxy.on("proxyRes", proxyRes => { proxyRes.headers["cache-control"] = "no-store, no-transform"; }); },
      },
      "/api/health": { target: "http://127.0.0.1:5174", changeOrigin: true },
    },
  },
});
