import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CORE_DIR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * the language core is typechecked under nodenext, so its relative imports end
 * in .js. those files do not exist on disk, only the .ts sources do, and vite's
 * bundler resolution does not rewrite the extension. this maps a relative .js
 * specifier back to its .ts source, but only inside the core.
 */
function resolveCoreTypeScript(): Plugin {
  return {
    name: "gpp-resolve-core-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) {
        return null;
      }
      if (!importer.startsWith(CORE_DIR)) return null;

      const candidate = resolvePath(dirname(importer), source).replace(
        /\.js$/,
        ".ts",
      );
      return existsSync(candidate) ? candidate : null;
    },
  };
}

// the site is served from https://<user>.github.io/gpp/, so assets need that
// prefix in a production build. GPP_BASE lets a fork or a local preview
// override it without editing this file.
const base = process.env.GPP_BASE ?? "/gpp/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? base : "/",
  plugins: [resolveCoreTypeScript(), react()],
  resolve: {
    alias: [
      // the language core lives outside the playground and is imported as
      // source, so there is no build step between the two.
      //
      // its imports carry .js extensions because the core is typechecked under
      // nodenext, which requires them. vite's bundler resolution would look for
      // a literal .js file and find nothing, so rewrite those specifiers back
      // to the .ts sources.
      {
        find: /^@gpp\/(.*)\.js$/,
        replacement: fileURLToPath(new URL("../src/$1.ts", import.meta.url)),
      },
      {
        find: "@gpp",
        replacement: fileURLToPath(new URL("../src", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // monaco dwarfs the app, so give it its own chunk to cache separately
        manualChunks(id: string) {
          if (id.includes("monaco")) return "monaco";
          if (id.includes("node_modules/react")) return "react";
          return undefined;
        },
      },
    },
  },
}));
