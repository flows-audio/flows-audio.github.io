import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Flows Audio',
  description: 'Code-native synthesis tools and experiments.',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    // Flows has no registered Shiki grammar; Python is the closest visual match
    // (`def`, `#` comments, numeric literals) so `.flow` blocks stay readable.
    languageAlias: {
      flow: 'python'
    }
  },
  themeConfig: {
    nav: [
      { text: 'Reference', link: '/reference/' },
      // Restore this when Flows Lab is ready to be public.
      // { text: 'Lab', link: 'https://flows-audio.github.io/flows-lab/' },
      { text: 'GitHub', link: 'https://github.com/flows-audio' }
    ],
    sidebar: {
      '/reference/': [
        {
          text: 'Language Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Producer mode', link: '/reference/producer' },
            { text: 'Developer mode', link: '/reference/developer' }
          ]
        }
      ]
    },
    search: {
      provider: 'local'
    },
    outline: {
      level: [2, 3],
      label: 'On this page'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/flows-audio' }
    ],
    footer: {
      message: 'Code-native synthesis tools and experiments.',
      copyright: 'Copyright © 2026 Flows Audio'
    }
  }
})
