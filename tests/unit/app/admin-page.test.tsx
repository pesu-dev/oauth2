// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AdminPage from '@/app/admin/page';

vi.mock('@/components/ui/drawer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/drawer')>();
  const MockDrawer = ({ children, open, onOpenChange, ...props }: React.ComponentProps<typeof actual.Drawer>) => {
    const Component = actual.Drawer;
    return (
      <div data-testid="mock-drawer">
        <button type="button" data-testid="drawer-trigger-true" onClick={() => onOpenChange?.(true)}>Open Drawer True</button>
        <button type="button" data-testid="drawer-trigger-false" onClick={() => onOpenChange?.(false)}>Close Drawer False</button>
        <Component open={open} onOpenChange={onOpenChange} {...props}>
          {children}
        </Component>
      </div>
    );
  };
  return {
    ...actual,
    Drawer: MockDrawer,
  };
});

describe('AdminPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially and then empty queue', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ requests: [] }),
    });

    render(<AdminPage />);
    expect(screen.getByText('Loading admin queue...')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('No Pending Requests')).toBeDefined();
    });
  });

  it('displays access denied when unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Access restricted to administrators' }),
    });

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeDefined();
      expect(screen.getByText('Access restricted to administrators')).toBeDefined();
    });
  });

  it('renders pending requests and handles Approve and Reject actions', async () => {
    const mockRequests = [
      {
        request_id: 'req_123',
        client_id: 'cli_abc',
        client_name: 'PESU Study App',
        owner_sub: 'usr_owner_1',
        status: 'pending',
        delegated_requested: true,
        justification: 'Need access to student courses for automation.',
        created_at: new Date().toISOString(),
      },
    ];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ requests: mockRequests }) };
    });

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('PESU Study App')).toBeDefined();
      expect(screen.getByText(/Need access to student courses/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /approve/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /reject/i })).toBeDefined();
    });

    // Toggle delegated
    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    // Click Approve
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/internal/admin/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req_123',
          action: 'approve',
          allowDelegated: false,
        }),
      });
    });

    // Click Reject
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/internal/admin/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req_123',
          action: 'reject',
          allowDelegated: true,
        }),
      });
    });
  });

  it('handles empty requests array fallback, default error string, identity-only without justification, and action failure/throw', async () => {
    // 1. ok response without requests field (falls back to [])
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.getByText('No Pending Requests')).toBeDefined();
    });

    // 2. error response without data.error
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Access restricted to administrators')).toBeDefined();
    });

    // 3. request item with delegated_requested=false and empty justification
    const item = {
      request_id: 'req_identity',
      client_id: 'cli_id',
      client_name: 'Identity App',
      owner_sub: 'usr_owner',
      status: 'pending',
      delegated_requested: false,
      justification: '',
      created_at: new Date().toISOString(),
    };
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        // fail POST response
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ requests: [item] }) };
    });

    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.getByText('Identity Only')).toBeDefined();
      expect(screen.getByText('None provided')).toBeDefined();
    });

    // 4. Click approve when POST returns ok: false
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    // 5. Click reject when fetch throws
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
  });

  it('navigates to All Clients tab, handles search, suspend drawer, and unsuspend action', async () => {
    const mockClients = [
      {
        client_id: 'cli_active',
        name: 'Active App',
        owner_sub: 'usr_dev1',
        publishing_status: 'testing',
        delegated_allowed: false,
        redirect_uris: ['http://localhost:3000/cb'],
        suspension_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        client_id: 'cli_suspended',
        name: 'Suspended App',
        owner_sub: 'usr_dev2',
        publishing_status: 'suspended',
        delegated_allowed: true,
        redirect_uris: ['http://localhost:3000/cb'],
        suspension_reason: 'Abusive API calls',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/internal/admin/clients')) {
        if (init?.method === 'PATCH') {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => ({ clients: mockClients }) };
      }
      return { ok: true, json: async () => ({ requests: [] }) };
    });

    render(<AdminPage />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.queryByText('Loading admin queue...')).toBeNull();
    });

    // Switch to All Clients tab
    const clientsTabBtn = screen.getByRole('button', { name: /all clients/i });
    fireEvent.click(clientsTabBtn);

    await waitFor(() => {
      expect(screen.getByText('Active App')).toBeDefined();
      expect(screen.getByText('Suspended App')).toBeDefined();
      expect(screen.getByText(/abusive api calls/i)).toBeDefined();
    });

    // Test Unsuspend action on suspended client
    const unsuspendBtn = screen.getByRole('button', { name: /unsuspend/i });
    fireEvent.click(unsuspendBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/internal/admin/clients',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            clientId: 'cli_suspended',
            action: 'unsuspend',
            targetStatus: 'testing',
          }),
        })
      );
    });

    // Test Suspend action on active client
    const suspendBtn = screen.getByRole('button', { name: /^suspend/i });
    fireEvent.click(suspendBtn);

    // Enter reason and confirm
    await waitFor(() => {
      expect(screen.getByText('Suspend Application')).toBeDefined();
    });

    const reasonInput = screen.getByPlaceholderText(/e\.g\. Terms violation/i);
    fireEvent.change(reasonInput, { target: { value: 'Spamming credentials' } });

    const confirmBtn = screen.getByRole('button', { name: /confirm suspension/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/internal/admin/clients',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            clientId: 'cli_active',
            action: 'suspend',
            reason: 'Spamming credentials',
          }),
        })
      );
    });

    // Search input change and submit
    const searchInput = screen.getByPlaceholderText('Search clients by name, ID, or owner...');
    fireEvent.change(searchInput, { target: { value: 'Active' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/internal/admin/clients?q=Active');
    });

    // Switch back to Production Queue tab (line 205)
    const requestsTabBtn = screen.getByRole('button', { name: /production queue/i });
    fireEvent.click(requestsTabBtn);
    expect(screen.getByText('No Pending Requests')).toBeDefined();

    // Switch back to clients tab
    fireEvent.click(clientsTabBtn);

    // Open suspend drawer again, test drawer trigger true & false (line 404)
    fireEvent.click(screen.getByRole('button', { name: /^suspend/i }));
    expect(screen.getByText('Suspend Application')).toBeDefined();

    fireEvent.click(screen.getByTestId('drawer-trigger-true'));
    expect(screen.getByText('Suspend Application')).toBeDefined();

    fireEvent.click(screen.getByTestId('drawer-trigger-false'));
    await waitFor(() => {
      expect(screen.queryByText('Suspend Application')).toBeNull();
    });
  });

  it('renders No Clients Found when clients list is empty and handles clients fetch without clients field', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/internal/admin/clients')) {
        return { ok: true, json: async () => ({}) }; // missing clients field -> fallback to []
      }
      return { ok: true, json: async () => ({ requests: [] }) };
    });

    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.queryByText('Loading admin queue...')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /all clients/i }));
    await waitFor(() => {
      expect(screen.getByText('No Clients Found')).toBeDefined();
      expect(screen.getByText('No client applications match your search criteria.')).toBeDefined();
    });
  });

  it('handles catch blocks on initial fetch', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Init fetch failed'));
    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.queryByText('Loading admin queue...')).toBeNull();
    });
  });

  it('handles PATCH failure on unsuspend and suspend, and empty suspend reason', async () => {
    // 2. Suspended client with null suspension reason, PATCH unsuspend failure, PATCH suspend failure
    const mockClients = [
      {
        client_id: 'cli_suspended_no_reason',
        name: 'Suspended No Reason App',
        owner_sub: 'usr_dev',
        publishing_status: 'suspended',
        delegated_allowed: false,
        redirect_uris: ['http://localhost:3000/cb'],
        suspension_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        client_id: 'cli_to_fail_suspend',
        name: 'Fail Suspend App',
        owner_sub: 'usr_dev',
        publishing_status: 'production',
        delegated_allowed: false,
        redirect_uris: ['http://localhost:3000/cb'],
        suspension_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/internal/admin/clients')) {
        if (init?.method === 'PATCH') {
          return { ok: false, json: async () => ({ error: 'Action failed' }) };
        }
        return { ok: true, json: async () => ({ clients: mockClients }) };
      }
      return { ok: true, json: async () => ({ requests: [] }) };
    });

    render(<AdminPage />);
    await waitFor(() => {
      expect(screen.queryByText('Loading admin queue...')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /all clients/i }));
    await waitFor(() => {
      expect(screen.getByText('Suspended No Reason App')).toBeDefined();
      expect(screen.queryByText('Suspension Reason:')).toBeNull();
    });

    // Click Unsuspend when PATCH returns ok: false
    fireEvent.click(screen.getAllByRole('button', { name: /unsuspend/i })[0]);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/internal/admin/clients',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    // Open Suspend drawer, test empty reason submit (form prevent)
    fireEvent.click(screen.getByRole('button', { name: /^suspend/i }));
    await waitFor(() => {
      expect(screen.getByText('Suspend Application')).toBeDefined();
    });

    const form = screen.getByRole('button', { name: /confirm suspension/i }).closest('form')!;
    fireEvent.submit(form); // whitespace or empty reason returns early

    // Enter whitespace only
    const reasonInput = screen.getByPlaceholderText(/e\.g\. Terms violation/i);
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    fireEvent.submit(form);

    // Enter valid reason but PATCH fails
    fireEvent.change(reasonInput, { target: { value: 'Legit reason' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm suspension/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/internal/admin/clients',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });
});
