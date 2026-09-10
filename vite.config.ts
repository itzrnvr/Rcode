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
  server: { port: 5173 },
});
