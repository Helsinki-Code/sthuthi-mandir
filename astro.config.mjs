import { defineConfig } from 'astro/config';

// SITE_URL must be set to the live domain before deploying (used for canonicals, sitemaps, schema).
export default defineConfig({
  site: process.env.SITE_URL || 'https://www.sthuthi.example',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
