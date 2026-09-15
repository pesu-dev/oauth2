// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ClientDetailPage from '@/app/portal/[clientId]/page';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ clientId: 'cli_portal_1' }),
}));

describe('ClientDetailPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockClientData = {
    client: {
      client_id: 'cli_portal_1',
      name: 'Timetable App',
      publishing_status: 'testing' as const,
      redirect_uris: ['https://app.pesu.edu/callback'],
      delegated_allowed: false,
    },
    testers: [
      {
        client_id: 'cli_portal_1',
        sub: 'usr_tester_1',
        added_at: new Date().toISOString(),
      },
    ],
  };

  it('renders loading state initially', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<ClientDetailPage />);
    expect(screen.getByText('Loading details...')).toBeDefined();
  });

  it('renders client details, redirect URIs, and testers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockClientData,
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
      expect(screen.getByText('cli_portal_1')).toBeDefined();
      expect(screen.getByText('testing')).toBeDefined();
      expect(screen.getByDisplayValue('https://app.pesu.edu/callback')).toBeDefined();
      expect(screen.getByText('usr_tester_1')).toBeDefined();
    });
  });

  it('handles adding and saving redirect URIs', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    // Add a redirect URI using quick add
    const addInput = screen.getByPlaceholderText(/Enter new URI/i);
    fireEvent.change(addInput, { target: { value: 'https://other.pesu.edu/callback' } });
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    fireEvent.click(addButtons[0]);

    // Save changes
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/clients/cli_portal_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirectUris: [
            'https://app.pesu.edu/callback',
            'https://other.pesu.edu/callback',
          ],
        }),
      });
    });
  });

  it('handles adding and removing testers', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/testers')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (init?.method === 'DELETE' && url.includes('/testers')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('usr_tester_1')).toBeDefined();
    });

    // Add new tester
    const testerInput = screen.getByPlaceholderText(/PRN or SRN/i);
    fireEvent.change(testerInput, { target: { value: 'PES1UG20CS555' } });
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/portal/clients/cli_portal_1/testers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'PES1UG20CS555' }),
      });
    });

    // Remove tester
    const testerRow = screen.getByText('usr_tester_1').parentElement;
    const removeBtn = testerRow?.querySelector('button');
    expect(removeBtn).toBeDefined();
    fireEvent.click(removeBtn!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/portal/clients/cli_portal_1/testers?sub=usr_tester_1',
        { method: 'DELETE' }
      );
    });
  });

  it('handles rotating client secret in drawer', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return {
          ok: true,
          json: async () => ({ clientSecret: 'sec_rotated_new_secret_999' }),
        };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Rotate Secret')).toBeDefined();
    });

    // Open rotate secret drawer
    fireEvent.click(screen.getByText('Rotate Secret'));

    // Confirm rotate
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));

    await waitFor(() => {
      expect(screen.getByText('sec_rotated_new_secret_999')).toBeDefined();
    });
  });

  it('handles requesting production in drawer', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/request-production')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Request Production')).toBeDefined();
    });

    // Open production drawer
    fireEvent.click(screen.getByText('Request Production'));

    // Fill in justification
    const textarea = screen.getByPlaceholderText(/explain your app's purpose/i);
    fireEvent.change(textarea, {
      target: { value: 'This is a campus-wide timetable application.' },
    });

    // Submit production request
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/portal/clients/cli_portal_1/request-production',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            justification: 'This is a campus-wide timetable application.',
          }),
        }
      );
    });
  });
});
