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
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
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

  it('renders identity-only mode when user has no vault and handles empty consents', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockSettingsData,
        hasVault: false,
        consents: [],
      }),
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Identity-only mode active')).toBeDefined();
      expect(screen.getByText("You haven't authorized any third-party applications yet.")).toBeDefined();
    });
  });

  it('handles updating vault password failure and success', async () => {
    let shouldFail = true;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url === '/api/settings') {
        if (shouldFail) {
          return {
            ok: false,
            json: async () => ({ error: 'Invalid password format' }),
          };
        }
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Update Password')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Update Password'));

    const passwordInput = screen.getByLabelText('New Academy Password');
    fireEvent.change(passwordInput, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Vault' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid password format')).toBeDefined();
    });

    // Now succeed
    shouldFail = false;
    fireEvent.change(passwordInput, { target: { value: 'ValidPassword123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Vault' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ newPassword: 'ValidPassword123' }),
      }));
    });
  });

  it('handles cancel button in password drawer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSettingsData,
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Update Password')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Update Password'));
    expect(screen.getByText('Cancel')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
  });

  it('handles revoke consent error response gracefully', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('action=consent')) {
        return { ok: false, json: async () => ({ error: 'Revoke failed' }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Revoke Access')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Revoke Access'));
  });

  it('handles account deletion permanently on typing DELETE', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('action=account')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('DELETE')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('DELETE');
    const deleteBtn = screen.getByRole('button', { name: 'Delete Account Permanently' });

    // Initially disabled
    expect(deleteBtn).toHaveProperty('disabled', true);

    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(deleteBtn).toHaveProperty('disabled', false);

    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings?action=account', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'DELETE' }),
      }));
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  it('shows error if account deletion API fails', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('action=account')) {
        return { ok: false, json: async () => ({ error: 'Account deletion failed' }) };
      }
      return { ok: true, json: async () => mockSettingsData };
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('DELETE')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('DELETE');
    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account Permanently' }));

    await waitFor(() => {
      expect(screen.getByText('Account deletion failed')).toBeDefined();
    });
  });
});

