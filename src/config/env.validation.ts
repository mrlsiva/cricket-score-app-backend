/**
 * Fail fast on missing / insecure configuration.
 */
export function validateEnv(config: Record<string, unknown>) {
  const errors: string[] = [];
  const isProd = config.NODE_ENV === 'production';

  if (!config.DATABASE_URL) errors.push('DATABASE_URL is required');
  const secret = String(config.JWT_ACCESS_SECRET ?? '');
  if (secret.length < 32) errors.push('JWT_ACCESS_SECRET must be at least 32 characters');
  if (isProd && !config.GOOGLE_CLIENT_IDS) errors.push('GOOGLE_CLIENT_IDS is required in production');
  if (isProd && String(config.AUTH_DEV_LOGIN) === 'true')
    errors.push('AUTH_DEV_LOGIN must not be enabled in production');
  if (config.STORAGE_DRIVER === 's3' && !config.S3_BUCKET) errors.push('S3_BUCKET is required when STORAGE_DRIVER=s3');

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return config;
}
