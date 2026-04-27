import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: do NOT import @mdx-js/rollup here
// Your Preview.tsx handles MDX manually.

export default defineConfig({
  plugins: [
    react(),

    // Prevent Vite from transforming MDX files
    {
      name: "disable-mdx-transform",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".mdx")) {
          // Return raw MDX content untouched
          return {
            code: `export default ${JSON.stringify(code)}`,
            map: null,
          };
        }
      },
    },
  ],

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
