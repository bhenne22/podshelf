// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  nitro: {
    experimental: {
      wasm: true,
    },
    // Bundle better-sqlite3 for server-side use
    externals: {
      inline: [],
    },
  },

  // Runtime config — values can be overridden by .env
  runtimeConfig: {
    // Server-only secrets
    databasePath: process.env.DATABASE_PATH || './data/podshelf.db',
    secretKey: process.env.NUXT_SECRET_KEY || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',

    // Storage
    storageAdapter: process.env.STORAGE_ADAPTER || 'sftp',

    // SFTP
    sftpHost: process.env.SFTP_HOST || '',
    sftpPort: process.env.SFTP_PORT || '22',
    sftpUser: process.env.SFTP_USER || '',
    sftpPrivateKeyPath: process.env.SFTP_PRIVATE_KEY_PATH || '',
    sftpRemoteDir: process.env.SFTP_REMOTE_DIR || '',
    sftpPublicUrlBase: process.env.SFTP_PUBLIC_URL_BASE || '',

    // S3 / Backblaze B2
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3Region: process.env.S3_REGION || 'us-east-1',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    s3BucketName: process.env.S3_BUCKET_NAME || '',
    s3PublicUrlBase: process.env.S3_PUBLIC_URL_BASE || '',

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
