// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://itskod.com',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Kod Docs',
      description: 'Documentation for the minimalist self-hosted Git tool.',
      favicon: '/favicon.svg',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/mikaelvesavuori/kod'
        }
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ autogenerate: { directory: 'getting-started' } }]
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }]
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }]
        }
      ]
    })
  ]
});
