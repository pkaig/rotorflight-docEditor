import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";

import rehypeImages from "./rehypeImagesPlugin";
import { remarkRewriteImageImports } from "./remarkRewriteImageImports";

export default defineConfig({
  plugins: [
    react(),
    mdx({
      remarkPlugins: [
        () => (tree, file) => remarkRewriteImageImports(file.path)(tree),
      ],
      rehypePlugins: [() => (tree, file) => rehypeImages(file.path)(tree)],
    }),
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
