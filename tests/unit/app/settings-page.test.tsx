// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SettingsPage from '@/app/settings/page';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

describe('SettingsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSettingsData = {
    user: {
      name: 'Jane Doe',
      prn: 'PES1UG20CS999',
      srn: 'PES1202001999',
      program: 'B.Tech',
      branch: 'CSE',
      semester: '6',
      section: 'A',
      campus: 'RR',
      email: 'jane@pesu.edu',
      phone: '9876543210',
    },
    hasVault: true,
    vaultUpdatedAt: new Date().toISOString(),
    consents: [
      {
        client_id: 'cli_third_party',
        client_name: 'Campus Maps',
        scopes: ['openid', 'profile'],
        mode: 'identity',
        granted_at: new Date().toISOString(),
      },
    ],
  };

  it('renders loading state initially', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<SettingsPage />);
    expect(screen.getByText('Loading settings...')).toBeDefined();
  });

  it('renders user details, vault info, and granted consents', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSettingsData,
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeDefined();
      expect(screen.getByText(/PES1UG20CS999/)).toBeDefined();
      expect(screen.getByText('Campus Maps')).toBeDefined();
      expect(screen.getByText('Revoke Access')).toBeDefined();
    });
  });

  it('handles revoking application consent', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('action=consent')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Revoke Access')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Revoke Access'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings?action=consent&client_id=cli_third_party',
        { method: 'DELETE' }
      );
    });
  });

  it('handles deleting vault credentials after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('action=vault')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Delete Vault')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Delete Vault'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings?action=vault', {
        method: 'DELETE',
      });
    });
  });
});
