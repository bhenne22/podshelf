// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  nitro: {
    experimental: {
      wasm: true,
    },
    externals: {
      inline: [],
    },
    routeRules: {
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        },
      },
    },
  },

  // Runtime config — values can be overridden by .env
  runtimeConfig: {
    // Server-only secrets
    // Don't `resolve()` here — that runs at build time and bakes in the
    // build machine's CWD. server/db/index.ts resolves at runtime so the
    // default works on whichever box ends up running this build.
    databasePath: process.env.DATABASE_PATH || './data/podshelf.db',
    secretKey: process.env.NUXT_SECRET_KEY || '',
    encryptionKey: process.env.PODSHELF_ENCRYPTION_KEY || '',
    geoipDbPath: process.env.GEOIP_DB_PATH || '',

    // Public — exposed to client
    public: {
      siteUrl: process.env.SITE_URL || 'http://localhost:3000',
    },
  },

  typescript: {
    strict: true,
  },

  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
    },
  },

  compatibilityDate: '2024-04-03',
})
