// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LoginPage from '@/app/login/page';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('renders sign in form with inputs and submit button', () => {
    render(<LoginPage />);
    expect(screen.getByText('Sign in with PESU')).toBeDefined();
    expect(screen.getByLabelText('PRN or SRN')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByRole('button', { name: /authenticate/i })).toBeDefined();
  });

  it('handles successful authentication and redirects to return_to', async () => {
    mockSearchParams = new URLSearchParams({ return_to: '/custom-return' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirectTo: '/custom-return' }),
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('PRN or SRN'), {
      target: { value: 'PES1UG20CS001' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'SecretPass123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /authenticate/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'SecretPass123',
          returnTo: '/custom-return',
        }),
      });
      expect(mockPush).toHaveBeenCalledWith('/custom-return');
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('displays error message when login fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid Academy credentials' }),
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('PRN or SRN'), {
      target: { value: 'PES1UG20CS001' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'WrongPass' },
    });

    fireEvent.click(screen.getByRole('button', { name: /authenticate/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid Academy credentials')).toBeDefined();
    });
  });

  it('handles network / unexpected errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('PRN or SRN'), {
      target: { value: 'PES1UG20CS001' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Pass' },
    });

    fireEvent.click(screen.getByRole('button', { name: /authenticate/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });
});
