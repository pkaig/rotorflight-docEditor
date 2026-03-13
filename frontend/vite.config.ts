import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";

import rehypeImages from "./src/mdx/rehypeImagesPlugin";
//import rehypeRewriteMarkdownImages from "./src/mdx/rehypeRewriteImageImports";
import rehypeImportedImages from "./src/mdx/rehypeRewriteImageImports";

export default defineConfig({
  plugins: [
    react(),
    {
      ...mdx({
        exclude: ["templates/**/*.mdx"],
        remarkPlugins: [],
        rehypePlugins: [rehypeImportedImages, rehypeImages],
      }),
      enforce: "pre",
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
