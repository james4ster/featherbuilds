// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://3a60652f.featherbuilds.pages.dev',
  build: { inlineStylesheets: 'always' },
  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});