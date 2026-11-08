// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://shaiknagurshareef.github.io",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [sitemap({ filter: (page) => !/\/audit\/?$/.test(new URL(page).pathname) })],
  vite: { plugins: [tailwindcss()] },
});
