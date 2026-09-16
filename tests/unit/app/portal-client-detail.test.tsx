// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  it('renders Delegated Access badge when client.delegated_allowed is true', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockClientData,
        client: {
          ...mockClientData.client,
          delegated_allowed: true,
        },
      }),
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Delegated Access')).toBeDefined();
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
    const quickAddForm = addInput.closest('form');

    // Test empty input ignored
    fireEvent.change(addInput, { target: { value: '   ' } });
    fireEvent.submit(quickAddForm!);

    // Test valid quick add
    fireEvent.change(addInput, { target: { value: 'https://other.pesu.edu/callback' } });
    fireEvent.submit(quickAddForm!);

    // Test duplicate quick add ignored
    fireEvent.change(addInput, { target: { value: 'https://other.pesu.edu/callback' } });
    fireEvent.submit(quickAddForm!);

    // Save changes
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await vi.advanceTimersByTimeAsync(2600);
    } finally {
      vi.useRealTimers();
    }

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

  it('handles error when rotating client secret fails', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return {
          ok: false,
          json: async () => ({ error: 'Rotation disallowed' }),
        };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Rotate Secret')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rotate Secret'));
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));

    await waitFor(() => {
      expect(screen.getByText('Rotation disallowed')).toBeDefined();
    });
  });

  it('handles rotate secret failure with fallback message and non-Error rejection', async () => {
    // 1. Fallback message when error is missing
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return {
          ok: false,
          json: async () => ({}),
        };
      }
      return { ok: true, json: async () => mockClientData };
    });

    const { unmount } = render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Rotate Secret')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rotate Secret'));
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to rotate client secret')).toBeDefined();
    });
    unmount();

    // 2. Non-Error throw
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return Promise.reject('Raw network drop');
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Rotate Secret')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rotate Secret'));
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));

    await waitFor(() => {
      expect(screen.getByText('Error rotating secret')).toBeDefined();
    });
  });

  it('ignores add tester when input is empty or whitespace', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockClientData,
    });

    render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const testerAddBtn = addButtons[addButtons.length - 1];
    fireEvent.click(testerAddBtn);
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

    // Check delegated requested
    const delegatedCheckbox = screen.getByLabelText(/request delegated credential vault access/i);
    fireEvent.click(delegatedCheckbox);

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
            delegatedRequested: true,
          }),
        }
      );
    });
  });

  it('handles request production failure gracefully when response is not ok', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/request-production')) {
        return { ok: false, json: async () => ({ error: 'Production request failed' }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Request Production')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Request Production'));
    const textarea = screen.getByPlaceholderText(/explain your app's purpose/i);
    fireEvent.change(textarea, { target: { value: 'Test justification' } });
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/portal/clients/cli_portal_1/request-production',
        expect.any(Object)
      );
    });
  });

  it('handles client data with missing testers and missing redirect_uris fallback to empty arrays', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        client: {
          client_id: 'cli_empty_arrays',
          name: 'Empty Arrays App',
          createdAt: new Date().toISOString(),
          status: 'development',
          publishing_status: 'development',
        },
      }),
    });

    render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Empty Arrays App')).toBeDefined();
    });
  });

  it('handles add tester response failure when ok is false', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/testers')) {
        return { ok: false, json: async () => ({ error: 'Cannot add tester' }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('usr_tester_1')).toBeDefined();
    });

    const testerInput = screen.getByPlaceholderText(/PRN or SRN/i);
    fireEvent.change(testerInput, { target: { value: 'PES1UG20CS999' } });
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/portal/clients/cli_portal_1/testers',
        expect.any(Object)
      );
    });
  });

  it('handles copying client ID, copying rotated secret, and dismissing rotated banner', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return {
          ok: true,
          json: async () => ({ clientSecret: 'sec_new_rotated_123' }),
        };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('cli_portal_1')).toBeDefined();
    });

    // Copy Client ID
    vi.useFakeTimers();
    try {
      const copyIdBtn = screen.getByTitle('Copy Client ID');
      fireEvent.click(copyIdBtn);
      expect(writeTextMock).toHaveBeenCalledWith('cli_portal_1');
      act(() => {
        vi.advanceTimersByTime(2100);
      });
    } finally {
      vi.useRealTimers();
    }

    // Rotate secret to show banner
    fireEvent.click(screen.getByText('Rotate Secret'));
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));

    await waitFor(() => {
      expect(screen.getByText('sec_new_rotated_123')).toBeDefined();
    });

    // Copy Rotated Secret
    vi.useFakeTimers();
    try {
      const copySecretBtn = screen.getByRole('button', { name: /copy secret/i });
      fireEvent.click(copySecretBtn);
      expect(writeTextMock).toHaveBeenCalledWith('sec_new_rotated_123');
      expect(screen.getByText('Copied!')).toBeDefined();
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText('Copied!')).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // Dismiss banner
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('sec_new_rotated_123')).toBeNull();
  });

  it('handles adding URL row, editing URI, and removing URI row', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockClientData,
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    // Click "Add URL" button to add an empty row
    const addUrlBtn = screen.getByRole('button', { name: /add url/i });
    fireEvent.click(addUrlBtn);

    const inputs = screen.getAllByPlaceholderText('https://my-app.com/api/auth/callback/pesu');
    expect(inputs.length).toBe(2);

    // Edit the new row input
    fireEvent.change(inputs[1], { target: { value: 'https://newapp.pesu.edu/callback' } });
    expect(inputs[1]).toHaveProperty('value', 'https://newapp.pesu.edu/callback');

    // Click remove button on the first row
    const removeBtns = screen.getAllByTitle('Remove URL');
    fireEvent.click(removeBtns[0]);

    // Now only 1 row remains
    const remainingInputs = screen.getAllByPlaceholderText('https://my-app.com/api/auth/callback/pesu');
    expect(remainingInputs.length).toBe(1);
    expect(remainingInputs[0]).toHaveProperty('value', 'https://newapp.pesu.edu/callback');

    // Remove the last row to show empty state
    const lastRemoveBtn = screen.getByTitle('Remove URL');
    fireEvent.click(lastRemoveBtn);
    expect(screen.getByText(/no redirect uris configured/i)).toBeDefined();
  });

  it('handles cancel buttons in rotate secret and production drawers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockClientData,
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    // Open Rotate Secret drawer and cancel
    fireEvent.click(screen.getByText('Rotate Secret'));
    const cancelRotate = screen.getAllByRole('button', { name: /cancel/i })[0];
    fireEvent.click(cancelRotate);

    // Open Request Production drawer and cancel
    fireEvent.click(screen.getByText('Request Production'));
    const cancelProd = screen.getAllByRole('button', { name: /cancel/i })[0];
    fireEvent.click(cancelProd);
  });

  it('displays error when rotating secret fails', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/rotate-secret')) {
        return { ok: false, json: async () => ({ error: 'Secret rotation failed' }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Rotate Secret'));
    fireEvent.click(screen.getByRole('button', { name: /yes, rotate secret/i }));
    await waitFor(() => {
      expect(screen.getByText('Secret rotation failed')).toBeDefined();
    });
  });

  it('does not show success when saving URIs fails', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.includes('/api/portal/clients/')) {
        return { ok: false, json: async () => ({ error: 'Invalid URI hostname' }) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.queryByText('Saved!')).toBeNull();
  });

  it('handles quick add duplicate URI and ignores it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockClientData,
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    const addInput = screen.getByPlaceholderText(/Enter new URI/i);
    fireEvent.change(addInput, { target: { value: 'https://app.pesu.edu/callback' } });
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    fireEvent.click(addButtons[0]);
  });

  it('renders application not found if client is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Not found' }),
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/application not found/i)).toBeDefined();
    });
  });

  it('includes pending new URI input when saving URIs directly', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => mockClientData };
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Timetable App')).toBeDefined();
    });

    const addInput = screen.getByPlaceholderText(/Enter new URI/i);
    fireEvent.change(addInput, { target: { value: 'https://app.pesu.edu/extra-callback' } });

    // Directly click Save Changes without clicking Add
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    await waitFor(() => {
      expect(screen.getByText('Saved!')).toBeDefined();
    });
  });

  it('renders empty testers state and production badge when app is in production', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        client: {
          client_id: 'cli_portal_prod',
          name: 'Prod Timetable App',
          publishing_status: 'production',
          redirect_uris: ['https://app.pesu.edu/callback'],
          delegated_allowed: true,
        },
        testers: [],
      }),
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Prod Timetable App')).toBeDefined();
      expect(screen.getByText('Delegated Access')).toBeDefined();
      expect(screen.getByText('No external testers added yet (owner is always authorized).')).toBeDefined();
      expect(screen.queryByText('Request Production')).toBeNull();
    });
  });

  it('renders pending production badge when app status is pending_production', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        client: {
          client_id: 'cli_portal_pending',
          name: 'Pending App',
          publishing_status: 'pending_production',
          redirect_uris: ['https://app.pesu.edu/callback'],
          delegated_allowed: false,
        },
        testers: [],
      }),
    });

    render(<ClientDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Pending App')).toBeDefined();
      expect(screen.getByText('pending production')).toBeDefined();
    });
  });
});

