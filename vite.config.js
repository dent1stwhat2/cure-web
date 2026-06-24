import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const publicBase = process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base: publicBase,
  plugins: [
    react(),
    process.env.DISABLE_PWA !== "true" && VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "CURE CLINIC — стоматологическая практика",
        short_name: "CURE CLINIC",
        description: "Пациенты, лечение, фотопротоколы и финансы клиники",
        theme_color: "#0f5278",
        background_color: "#f4f7f9",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: publicBase,
        scope: publicBase,
        lang: "ru",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"]
      }
    })
  ].filter(Boolean)
});
