import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { jwt } from 'better-auth/plugins/jwt';
import { organization } from 'better-auth/plugins/organization';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;
let _migrated = false;

function createAuth() {
  const dbPath = process.env.AUTH_DATABASE_URL ?? '/data/auth.db';
  mkdirSync(dirname(dbPath), { recursive: true });

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  }

  const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return betterAuth({
    database: new Database(dbPath),
    secret: secret ?? 'dev-only-insecure-secret-do-not-use-in-prod',
    baseURL,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID ?? '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      },
    },
    plugins: [
      jwt({
        jwt: {
          expirationTime: '15m',
        },
      }),
      organization({
        creatorRole: 'owner',
      }),
    ],
  });
}

export async function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  if (!_migrated) {
    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(_auth.options);
    if (toBeCreated.length || toBeAdded.length) {
      console.log('[auth] Running migrations:', { toBeCreated, toBeAdded });
      await runMigrations();
      console.log('[auth] Migrations complete');
    }
    _migrated = true;
  }
  return _auth;
}

export type Auth = ReturnType<typeof createAuth>;
