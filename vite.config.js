import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version)
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("@supabase") || id.includes("/jose/")) return "vendor-supabase";
          return undefined;
        }
      }
    }
  }
});
