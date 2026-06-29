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
    }
  },
  themeConfig: {
    nav: [
      // Restore this when Flows Lab is ready to be public.
      // { text: 'Lab', link: 'https://flows-audio.github.io/flows-lab/' },
      { text: 'GitHub', link: 'https://github.com/flows-audio' }
    ],
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
