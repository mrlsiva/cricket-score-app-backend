const bool = (v: string | undefined, def = false) =>
  v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(v.toLowerCase());
const int = (v: string | undefined, def: number) => (v ? parseInt(v, 10) : def);
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const BRANDING = 'Developed by Sling Groups';

export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 3000),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  corsOrigins: list(process.env.CORS_ORIGINS ?? '*'),
  logJson: bool(process.env.LOG_JSON),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresDays: int(process.env.JWT_REFRESH_EXPIRES_DAYS, 30),
  },
  google: {
    clientIds: list(process.env.GOOGLE_CLIENT_IDS),
  },
  auth: {
    devLogin: bool(process.env.AUTH_DEV_LOGIN) && process.env.NODE_ENV !== 'production',
    superAdminEmails: list(process.env.SUPER_ADMIN_EMAILS).map((e) => e.toLowerCase()),
  },
  redis: {
    enabled: bool(process.env.REDIS_ENABLED),
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
    uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
    s3: {
      bucket: process.env.S3_BUCKET ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      publicUrl: process.env.S3_PUBLIC_URL ?? '',
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    },
  },
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
  },
  throttle: {
    ttl: int(process.env.THROTTLE_TTL_MS, 60000),
    limit: int(process.env.THROTTLE_LIMIT, 300),
  },
});
