// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import PortalPage from '@/app/portal/page';

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

describe('PortalPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockClients = [
    {
      client_id: 'cli_portal_1',
      name: 'PESU Study Timetable',
      publishing_status: 'testing' as const,
      redirect_uris: ['https://timetable.pesu.edu/callback'],
      delegated_allowed: false,
      created_at: new Date().toISOString(),
    },
  ];

  it('renders loading state initially and then empty state when no apps', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clients: [] }),
    });

    render(<PortalPage />);
    expect(screen.getByText('Loading applications...')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('No applications registered yet')).toBeDefined();
    });
  });

  it('renders list of client applications', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clients: mockClients }),
    });

    render(<PortalPage />);

    await waitFor(() => {
      expect(screen.getByText('PESU Study Timetable')).toBeDefined();
      expect(screen.getByText('cli_portal_1')).toBeDefined();
      expect(screen.getByText('testing')).toBeDefined();
    });
  });

  it('handles client app creation and displays secret callout', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            client: {
              client_id: 'cli_new_app',
              name: 'New Campus App',
            },
            rawSecret: 'sec_very_secret_key_123',
          }),
        };
      }
      return { ok: true, json: async () => ({ clients: mockClients }) };
    });

    render(<PortalPage />);

    await waitFor(() => {
      expect(screen.getByText('Register Application')).toBeDefined();
    });

    // Open drawer
    fireEvent.click(screen.getByText('Register Application'));

    // Fill out form
    fireEvent.change(screen.getByLabelText(/application name/i), {
      target: { value: 'New Campus App' },
    });
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), {
      target: { value: 'https://campus.pesu.edu/callback' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /^create application$/i }));

    await waitFor(() => {
      expect(screen.getByText('Save your Client Secret immediately')).toBeDefined();
      expect(screen.getByText('sec_very_secret_key_123')).toBeDefined();
    });

    // Copy secret
    const secretSpan = screen.getByText('sec_very_secret_key_123');
    const secretCopyBtn = secretSpan.parentElement?.querySelector('button');
    expect(secretCopyBtn).toBeDefined();
    fireEvent.click(secretCopyBtn!);
    expect(writeTextMock).toHaveBeenCalledWith('sec_very_secret_key_123');
  });

  it('displays creation error message when API returns failure', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: false,
          json: async () => ({ error: 'Redirect URI invalid' }),
        };
      }
      return { ok: true, json: async () => ({ clients: mockClients }) };
    });

    render(<PortalPage />);

    await waitFor(() => {
      expect(screen.getByText('Register Application')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Register Application'));

    fireEvent.change(screen.getByLabelText(/application name/i), {
      target: { value: 'Invalid App' },
    });
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), {
      target: { value: 'http://not-https.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^create application$/i }));

    await waitFor(() => {
      expect(screen.getByText('Redirect URI invalid')).toBeDefined();
    });
  });
});
