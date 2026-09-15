import { nanoid } from 'nanoid';

export interface PendingCredentials {
  username: string;
  password: string;
  sessionToken?: string;
  accessToken?: string | null;
  userId?: string | null;
  expiresAt?: Date | null;
}

interface StoredItem {
  expiresAtMs: number;
  credentials: PendingCredentials;
}

export class PendingCredentialStore {
  private ttlMs: number;
  private items: Map<string, StoredItem>;

  constructor(ttlSeconds: number = 600) {
    this.ttlMs = ttlSeconds * 1000;
    this.items = new Map();
  }

  public put(creds: PendingCredentials): string {
    this.purgeExpired();
    const credId = `pcred_${nanoid(32)}`;
    this.items.set(credId, {
      expiresAtMs: Date.now() + this.ttlMs,
      credentials: creds,
    });
    return credId;
  }

  public get(credId: string): PendingCredentials | null {
    this.purgeExpired();
    const item = this.items.get(credId);
    if (!item) return null;
    return item.credentials;
  }

  public pop(credId: string): PendingCredentials | null {
    this.purgeExpired();
    const item = this.items.get(credId);
    if (!item) return null;
    this.items.delete(credId);
    return item.credentials;
  }

  public delete(credId: string): boolean {
    this.purgeExpired();
    return this.items.delete(credId);
  }

  public reset(): void {
    this.items.clear();
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, item] of this.items.entries()) {
      if (item.expiresAtMs <= now) {
        this.items.delete(id);
      }
    }
  }
}

declare global {
  var __pendingCredentialStore: PendingCredentialStore | undefined;
}

export const pendingCredentialStore =
  globalThis.__pendingCredentialStore || new PendingCredentialStore();

if (!globalThis.__pendingCredentialStore) {
  globalThis.__pendingCredentialStore = pendingCredentialStore;
}
