import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";

import rehypeImages from "./src/mdx/rehypeImagesPlugin";
import remarkImportedImages from "./src/mdx/remarkImportedImages";

export default defineConfig({
  plugins: [
    react(),
    {
      ...mdx({
        remarkPlugins: [remarkImportedImages],
        rehypePlugins: [rehypeImages],
        mdxOptions: {
          providerImportSource: "@mdx-js/react",
          development: true,
          filePath: true,
        },
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
