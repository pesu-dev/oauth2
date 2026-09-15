import { describe, it, expect, vi } from 'vitest';
import { PendingCredentialStore } from '@/lib/session/pending-credentials';

describe('PendingCredentialStore', () => {
  it('stores and retrieves pending credentials by unique cred_id', () => {
    const store = new PendingCredentialStore(60);
    const credId = store.put({
      username: 'pes1202000001',
      password: 'supersecretpassword',
      sessionToken: 'token-abc',
      accessToken: 'access-xyz',
      userId: 'usr_123',
    });

    expect(credId).toMatch(/^pcred_[A-Za-z0-9_-]{32}$/);
    const retrieved = store.get(credId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.username).toBe('pes1202000001');
    expect(retrieved?.password).toBe('supersecretpassword');
  });

  it('pop removes the credential from the store', () => {
    const store = new PendingCredentialStore(60);
    const credId = store.put({
      username: 'pes1202000002',
      password: 'password123',
    });

    const popped = store.pop(credId);
    expect(popped?.username).toBe('pes1202000002');
    expect(store.get(credId)).toBeNull();
    expect(store.pop(credId)).toBeNull();
  });

  it('delete removes the credential from the store', () => {
    const store = new PendingCredentialStore(60);
    const credId = store.put({
      username: 'pes1202000003',
      password: 'password123',
    });

    expect(store.delete(credId)).toBe(true);
    expect(store.get(credId)).toBeNull();
    expect(store.delete(credId)).toBe(false);
  });

  it('expires old credentials past TTL', () => {
    vi.useFakeTimers();
    try {
      const store = new PendingCredentialStore(10); // 10 seconds TTL
      const credId = store.put({
        username: 'pes1202000004',
        password: 'password123',
      });

      expect(store.get(credId)).not.toBeNull();

      // Advance time by 11 seconds
      vi.advanceTimersByTime(11000);

      expect(store.get(credId)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
