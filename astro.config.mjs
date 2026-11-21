// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://b2a0644b.featherbuilds.pages.dev',
  build: { inlineStylesheets: 'always' },
  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});