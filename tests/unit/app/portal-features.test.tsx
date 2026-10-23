// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import ClientDetailPage from '@/app/portal/[clientId]/page';
import AdminPage from '@/app/admin/page';
import { newImageId, newTeamId } from '@/lib/id/nanoid';

vi.mock('next/navigation', () => ({
  useParams: () => ({ clientId: 'cli_1' }),
  usePathname: () => '/portal/cli_1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

type Handler = (url: string, init?: RequestInit) => { ok: boolean; body: unknown } | undefined;

function mockFetch(detail: Record<string, unknown>, handler: Handler = () => undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const hit = handler(url, init);
    if (hit) return { ok: hit.ok, json: async () => hit.body } as Response;
    return { ok: true, json: async () => detail } as Response;
  });
  global.fetch = fetchMock as never;
  return fetchMock;
}

const baseClient = {
  client_id: 'cli_1',
  name: 'Bot Tracker',
  publishing_status: 'production',
  redirect_uris: [],
  delegated_allowed: false,
  allowed_scopes: ['attendance:read'],
};

describe('id generators', () => {
  it('prefixes team and image ids', () => {
    expect(newTeamId()).toMatch(/^team_/);
    expect(newImageId()).toMatch(/^img_[\w-]{24}$/);
  });
});

describe('client detail: logo, device flow, team and permissions', () => {
  it('uploads, rejects oversize files, and removes the logo', async () => {
    const fetchMock = mockFetch({ client: baseClient, testers: [], permissions: { secrets: true, publish: true }, team: null }, (url, init) => {
      if (url.endsWith('/logo') && init?.method === 'POST') return { ok: true, body: { logo: { image_id: 'img_new' } } };
      if (url.endsWith('/logo') && init?.method === 'DELETE') return { ok: true, body: { success: true } };
      return undefined;
    });
    render(<ClientDetailPage />);
    await screen.findByText('App logo');
    expect(screen.getByText('No logo')).toBeDefined();
    expect(screen.getByText('attendance:read')).toBeDefined();

    const input = screen.getByLabelText('Choose logo file') as HTMLInputElement;
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('Images must be 256 KB or smaller')).toBeDefined();

    const small = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [small] } });
    });
    expect(await screen.findByText('Awaiting review')).toBeDefined();
    expect(screen.getByAltText('Bot Tracker logo').getAttribute('src')).toBe('/img/img_new');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(screen.getByText('No logo')).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/portal/clients/cli_1/logo', { method: 'DELETE' });

    fireEvent.click(screen.getByRole('button', { name: 'Upload logo' }));
    fireEvent.change(input, { target: { files: [] } });
  });

  it('shows upload errors and review statuses', async () => {
    mockFetch(
      { client: { ...baseClient, logo_image_id: 'img_1', logo_status: 'approved' }, testers: [] },
      (url, init) => (url.endsWith('/logo') && init?.method === 'POST' ? { ok: false, body: { error: 'Upload a PNG, JPEG or WebP image' } } : undefined)
    );
    const { unmount } = render(<ClientDetailPage />);
    expect(await screen.findByText('Shown on consent')).toBeDefined();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose logo file'), { target: { files: [new File(['x'], 'a.gif')] } });
    });
    expect(await screen.findByText('Upload a PNG, JPEG or WebP image')).toBeDefined();
    unmount();

    mockFetch(
      { client: { ...baseClient, logo_image_id: 'img_1', logo_status: 'rejected' }, testers: [] },
      (url, init) => (url.endsWith('/logo') && init?.method ? { ok: false, body: {} } : undefined)
    );
    render(<ClientDetailPage />);
    expect(await screen.findByText('Not approved')).toBeDefined();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose logo file'), { target: { files: [new File(['x'], 'a.png')] } });
    });
    expect(await screen.findByText('Upload failed')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    expect(screen.getByText('Not approved')).toBeDefined();
  });

  it('toggles device sign-in and links the owning team', async () => {
    const fetchMock = mockFetch(
      { client: baseClient, testers: [], permissions: { secrets: true, publish: true }, team: { team_id: 'team_1', name: 'Robotics Club' } },
      (url, init) => (init?.method === 'PATCH' ? { ok: true, body: {} } : undefined)
    );
    render(<ClientDetailPage />);
    const badge = await screen.findByText('Team: Robotics Club');
    expect(badge.closest('a')?.getAttribute('href')).toBe('/portal/teams/team_1');

    const toggle = screen.getByRole('checkbox', { name: /device sign-in/i }) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/portal/clients/cli_1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ deviceFlowEnabled: true }) }));
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it('keeps the toggle off when saving fails, and hides owner-only actions from developers', async () => {
    mockFetch(
      { client: baseClient, testers: [], permissions: { secrets: false, publish: false }, team: null },
      (url, init) => (init?.method === 'PATCH' ? { ok: false, body: {} } : undefined)
    );
    render(<ClientDetailPage />);
    await screen.findByText('Bot Tracker');
    expect(screen.queryByRole('button', { name: /request api access/i })).toBeNull();
    expect((screen.getByRole('button', { name: /rotate secret/i }) as HTMLButtonElement).disabled).toBe(true);
    const toggle = screen.getByRole('checkbox', { name: /device sign-in/i }) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.checked).toBe(false);
  });

  it('requests API scopes for a production app and reports errors', async () => {
    const fetchMock = mockFetch({ client: baseClient, testers: [] }, (url) =>
      url.endsWith('/request-production') ? { ok: false, body: { error: 'All requested scopes are already approved.' } } : undefined
    );
    render(<ClientDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /request api access/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Already approved')).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText(/justification/i), { target: { value: 'Shows timetable and results to members' } });
    const results = within(dialog).getByText('results:read').closest('label')!.querySelector('input')!;
    fireEvent.click(results);
    fireEvent.click(results);
    fireEvent.click(results);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /submit for review/i }));
    });
    const body = JSON.parse(String(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/request-production'))![1]!.body));
    expect(body).toMatchObject({ requestedScopes: ['results:read'], productionRequested: false });
    expect(await within(dialog).findByText('All requested scopes are already approved.')).toBeDefined();
  });

  it('falls back to a generic message when the request error has no body', async () => {
    mockFetch({ client: baseClient, testers: [] }, (url) =>
      url.endsWith('/request-production') ? { ok: false, body: {} } : undefined
    );
    render(<ClientDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /request api access/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/justification/i), { target: { value: 'A valid justification text' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /submit for review/i }));
    });
    expect(await within(dialog).findByText('Request failed')).toBeDefined();
  });
});

describe('admin logo reviews', () => {
  it('lists pending logos and approves or rejects them', async () => {
    const pending = [
      { client_id: 'cli_1', name: 'Bot Tracker', logo_image_id: 'img_1' },
      { client_id: 'cli_2', name: 'Chess App', logo_image_id: 'img_2' },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/internal/admin/requests') return { ok: true, json: async () => ({ requests: [] }) } as Response;
      if (url.includes('logos=pending')) return { ok: true, json: async () => ({ clients: pending }) } as Response;
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ clients: [] }) } as Response;
    });
    global.fetch = fetchMock as never;

    render(<AdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /logo reviews/i }));
    expect(await screen.findByAltText('Bot Tracker logo')).toBeDefined();

    const firstCard = screen.getByText('Bot Tracker').closest('li')!;
    await act(async () => {
      fireEvent.click(within(firstCard).getByRole('button', { name: 'Approve' }));
    });
    await waitFor(() => expect(screen.queryByText('Bot Tracker')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/internal/admin/clients', expect.objectContaining({ body: JSON.stringify({ clientId: 'cli_1', action: 'approve_logo' }) }));

    const secondCard = screen.getByText('Chess App').closest('li')!;
    await act(async () => {
      fireEvent.click(within(secondCard).getByRole('button', { name: 'Reject' }));
    });
    expect(await screen.findByText('No logos to review')).toBeDefined();
  });

  it('keeps logos listed when review fails and tolerates a failing list call', async () => {
    let listCalls = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/internal/admin/requests') return { ok: true, json: async () => ({ requests: [] }) } as Response;
      if (url.includes('logos=pending')) {
        listCalls++;
        if (listCalls > 1) throw new Error('network');
        return { ok: true, json: async () => ({ clients: [{ client_id: 'cli_1', name: 'Bot Tracker' }] }) } as Response;
      }
      if (init?.method === 'PATCH') return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ clients: [] }) } as Response;
    }) as never;

    render(<AdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /logo reviews/i }));
    const card = (await screen.findByText('Bot Tracker')).closest('li')!;
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    });
    expect(screen.getByText('Bot Tracker')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /logo reviews/i }));
    });
    expect(screen.getByText('Bot Tracker')).toBeDefined();
  });
});
