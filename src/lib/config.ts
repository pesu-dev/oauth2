import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const ENVIRONMENT_DEFAULTS = {
  prod: {
    mongoUri: 'mongodb+srv://pesudev.nkzgere.mongodb.net/',
    issuerUrl: 'https://oauth2-prod-66snrlj46a-uc.a.run.app',
  },
  staging: {
    mongoUri: 'mongodb+srv://pesudev.andmjbp.mongodb.net/',
    issuerUrl: 'https://oauth2-staging-66snrlj46a-uc.a.run.app',
  },
  local: {
    mongoUri: 'mongodb+srv://pesudev.andmjbp.mongodb.net/',
    issuerUrl: 'http://localhost:3000',
  },
} as const;

export const ConfigSchema = z.object({
  appEnv: z.enum(['local', 'staging', 'prod']).default('local'),
  mongoUri: z.string(),
  issuerUrl: z.string(),
  dbName: z.string().default('oauth2'),
  mongoX509CertPath: z.string().optional(),
  accessTokenTtlSeconds: z.number().default(3600),
  idTokenTtlSeconds: z.number().default(3600),
  refreshTokenTtlSeconds: z.number().default(14 * 24 * 3600),
  authorizationCodeTtlSeconds: z.number().default(600),
  sessionCookieTtlSeconds: z.number().default(1800),
  vaultMasterKey: z.string().optional(),
  tokenExchangeSecret: z.string().optional(),
  sessionSecret: z.string().default('pesu-oauth2-session-secret-at-least-32-chars!'),
  firstPartyApiClientId: z.string().default('cli_pesu_api'),
  tokenSigningKeyPath: z.string().optional(),
  tokenSigningKeyPem: z.string().optional(),
  gmailSmtpUser: z.string().optional(),
  gmailSmtpAppPassword: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function getConfig(): AppConfig {
  const rawEnv = (process.env.APP_ENV || 'local') as 'local' | 'staging' | 'prod';
  const appEnv = ['local', 'staging', 'prod'].includes(rawEnv) ? rawEnv : 'local';

  const defaultForEnv = ENVIRONMENT_DEFAULTS[appEnv];

  const mongoUri = process.env.MONGODB_URI || defaultForEnv.mongoUri;
  const issuerUrl = process.env.ISSUER_URL || defaultForEnv.issuerUrl;

  const defaultCertPath = fs.existsSync(path.resolve(process.cwd(), 'scratch/mongo-dev.pem'))
    ? path.resolve(process.cwd(), 'scratch/mongo-dev.pem')
    : undefined;
  const mongoX509CertPath = process.env.MONGO_X509_CERT_PATH || defaultCertPath;

  const defaultKeyPath = fs.existsSync(path.resolve(process.cwd(), 'scratch/token-signing.pem'))
    ? path.resolve(process.cwd(), 'scratch/token-signing.pem')
    : undefined;
  const tokenSigningKeyPath = process.env.TOKEN_SIGNING_KEY_PATH || defaultKeyPath;

  let tokenSigningKeyPem = process.env.TOKEN_SIGNING_KEY_PEM;
  if (!tokenSigningKeyPem && tokenSigningKeyPath && fs.existsSync(tokenSigningKeyPath)) {
    try {
      tokenSigningKeyPem = fs.readFileSync(tokenSigningKeyPath, 'utf-8');
    } catch {
      // Ignore unreadable key file
    }
  }

  return ConfigSchema.parse({
    appEnv,
    mongoUri,
    issuerUrl,
    dbName: process.env.DB_NAME || 'oauth2',
    mongoX509CertPath,
    vaultMasterKey: process.env.VAULT_MASTER_KEY,
    tokenExchangeSecret: process.env.TOKEN_EXCHANGE_SECRET,
    sessionSecret: process.env.SESSION_SECRET || 'pesu-oauth2-session-secret-at-least-32-chars!',
    firstPartyApiClientId: process.env.FIRST_PARTY_API_CLIENT_ID || 'cli_pesu_api',
    tokenSigningKeyPath,
    tokenSigningKeyPem,
    gmailSmtpUser: process.env.GMAIL_SMTP_USER,
    gmailSmtpAppPassword: process.env.GMAIL_SMTP_APP_PASSWORD,
  });
}
