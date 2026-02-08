import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AgentLens',
  base: '/agentlens/',
  description: 'Open-source observability & audit trail platform for AI agents',
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'AgentLens',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/reference/api' },
      { text: 'Architecture', link: '/architecture/overview' },
      {
        text: 'Ecosystem',
        items: [
          {
            text: 'AgentGate',
            link: 'https://github.com/amitpaz/agentgate',
          },
          {
            text: 'FormBridge',
            link: 'https://github.com/amitpaz/formbridge',
          },
        ],
      },
      {
        text: 'v0.1.0',
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/amitpaz/agentlens/blob/main/CHANGELOG.md',
          },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/org/agentlens',
          },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Quick Start', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'MCP Integration', link: '/guide/mcp-integration' },
          { text: 'Dashboard', link: '/guide/dashboard' },
          { text: 'Integrations', link: '/guide/integrations' },
          { text: 'Alerting', link: '/guide/alerting' },
          { text: 'Cost Tracking', link: '/guide/cost-tracking' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/reference/api' },
          { text: 'Events API', link: '/reference/events' },
          { text: 'Sessions API', link: '/reference/sessions' },
          { text: 'Analytics API', link: '/reference/analytics' },
          { text: 'Alerts API', link: '/reference/alerts' },
          { text: 'Integrations API', link: '/reference/integrations' },
          { text: 'API Keys', link: '/reference/api-keys' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/overview' },
          { text: 'Event Model', link: '/architecture/event-model' },
          { text: 'Storage', link: '/architecture/storage' },
          { text: 'Security', link: '/architecture/security' },
        ],
      },
    ],

    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/amitpaz/agentlens',
      },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Amit Paz',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/amitpaz/agentlens/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
