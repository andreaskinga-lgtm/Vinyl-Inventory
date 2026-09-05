import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

import { createApiHandler } from "./server/api-handler.js";
import { loadConfig } from "./server/config.js";

function apiPlugin() {
  return {
    name: "api-adapter",
    configureServer(server) {
      const config = loadConfig();
      const apiHandler = createApiHandler({
        dataDir: config.dataDir,
        fetch: globalThis.fetch,
        discogsEnvironment: config.discogsEnvironment,
      });

      server.middlewares.use(apiHandler);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true, // enables SW in dev mode
      },
      includeAssets: [
        "vinyl-icon.svg",
        "vinyl-icon-192.png",
        "vinyl-icon-512.png",
      ],
      manifest: {
        name: "Vinyl Collection",
        short_name: "Vinyl",
        description: "Browse and manage your vinyl record collection",
        start_url: "/",
        display: "standalone",
        background_color: "#242424",
        theme_color: "#242424",
        orientation: "any",
        icons: [
          {
            src: "/vinyl-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/vinyl-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/vinyl-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    apiPlugin(),
  ],
  server: {
    host: true, // listen on all network interfaces (0.0.0.0)
  },
});
