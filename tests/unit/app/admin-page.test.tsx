// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AdminPage from '@/app/admin/page';

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
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/requests', {
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
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/requests', {
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
});
