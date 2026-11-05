// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { Client, ClientTester, Team, TeamMember, User } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { GET as listTeams, POST as createTeam } from '@/app/api/internal/teams/route';
import { GET as getTeam, PATCH as renameTeam } from '@/app/api/internal/teams/[teamId]/route';
import { POST as addMember, PATCH as changeRole, DELETE as removeMember } from '@/app/api/internal/teams/[teamId]/members/route';
import { POST as createClient } from '@/app/api/internal/portal/clients/route';
import {
  canManageClient,
  findManageableClient,
  getTeamRole,
  isAllowedTester,
  publisherName,
  roleAllows,
  teamIdsFor,
} from '@/lib/authz/client-access';
import { canChangeMember, isTeamRole, slugify } from '@/lib/teams';
import { resolveUserSub } from '@/lib/users';
import TeamPage from '@/app/portal/teams/[teamId]/page';
import PortalPage from '@/app/portal/page';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'tx' })),
}));
vi.mock('@/lib/mailer', () => ({ notifySubQuietly: vi.fn() }));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ teamId: 'team_1' }),
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/portal',
}));

const lean = <T,>(value: T) => ({ lean: () => Promise.resolve(value) }) as never;
const sorted = <T,>(value: T) => ({ sort: () => ({ lean: () => Promise.resolve(value) }) }) as never;

function memberRoles(roles: Record<string, string | null>) {
  vi.spyOn(TeamMember, 'findOne').mockImplementation(((filter: { sub: string }) =>
    lean(roles[filter.sub] ? { role: roles[filter.sub] } : null)) as never);
}

function request(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { cookie: 'pesu_session=s', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const TEAM = { params: Promise.resolve({ teamId: 'team_1' }) };

describe('team helpers', () => {
  it('slugifies names', () => {
    expect(slugify('Robotics Club!')).toBe('robotics-club');
    expect(slugify('  ÄÖ  ')).toBe('ao');
    expect(slugify('Café Club')).toBe('cafe-club');
    expect(slugify('!!!')).toBe('team');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
  });

  it('validates roles and member-change rules', () => {
    expect(isTeamRole('admin')).toBe(true);
    expect(isTeamRole('root')).toBe(false);
    expect(isTeamRole(3)).toBe(false);
    expect(canChangeMember('owner', 'owner', 'developer')).toBe(true);
    expect(canChangeMember('admin', 'developer', 'admin')).toBe(true);
    expect(canChangeMember('admin', 'owner')).toBe(false);
    expect(canChangeMember('admin', null, 'owner')).toBe(false);
    expect(canChangeMember('developer', 'developer')).toBe(false);
    expect(canChangeMember(null, null)).toBe(false);
  });

  it('resolves people by sub, PRN or SRN', async () => {
    vi.restoreAllMocks();
    expect(await resolveUserSub('  ')).toEqual({ ok: false, error: 'Identifier is required' });
    expect(await resolveUserSub(5)).toMatchObject({ ok: false });
    expect(await resolveUserSub(' usr_x ')).toEqual({ ok: true, sub: 'usr_x' });
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_y' } as never);
    expect(await resolveUserSub('PES1')).toEqual({ ok: true, sub: 'usr_y' });
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    const missing = await resolveUserSub('PES2', 'Team members');
    expect(missing.ok ? '' : missing.error).toContain('Team members must be registered users');
  });
});

describe('client access rules', () => {
  beforeEach(() => vi.restoreAllMocks());

  const userClient = { client_id: 'c', owner_sub: 'usr_a', owner_type: 'user' as const, owner_team_id: null };
  const teamClient = { client_id: 'c', owner_sub: 'usr_a', owner_type: 'team' as const, owner_team_id: 'team_1' };

  it('grants actions by team role', () => {
    expect(roleAllows('developer', 'edit')).toBe(true);
    expect(roleAllows('developer', 'secrets')).toBe(false);
    expect(roleAllows('admin', 'publish')).toBe(true);
    expect(roleAllows(null, 'view')).toBe(false);
  });

  it('checks user-owned and team-owned clients', async () => {
    expect(await canManageClient('usr_a', userClient, 'secrets')).toBe(true);
    expect(await canManageClient('usr_b', userClient, 'view')).toBe(false);
    memberRoles({ usr_dev: 'developer', usr_admin: 'admin' });
    expect(await canManageClient('usr_dev', teamClient, 'edit')).toBe(true);
    expect(await canManageClient('usr_dev', teamClient, 'secrets')).toBe(false);
    expect(await canManageClient('usr_admin', teamClient, 'secrets')).toBe(true);
    // The creator has no special rights once a team owns the client
    expect(await canManageClient('usr_a', teamClient, 'view')).toBe(false);
    expect(await getTeamRole('team_1', 'usr_admin')).toBe('admin');
  });

  it('loads manageable clients only', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);
    expect(await findManageableClient('c', 'usr_a', 'view')).toBeNull();
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(userClient as never);
    expect(await findManageableClient('c', 'usr_b', 'view')).toBeNull();
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(userClient as never);
    expect(await findManageableClient('c', 'usr_a', 'view')).toEqual(userClient);
  });

  it('applies the testing allowlist', async () => {
    vi.spyOn(ClientTester, 'findOne').mockResolvedValue(null);
    expect(await isAllowedTester(userClient, 'usr_a')).toBe(true);
    expect(await isAllowedTester(userClient, 'usr_b')).toBe(false);
    memberRoles({ usr_dev: 'developer' });
    expect(await isAllowedTester(teamClient, 'usr_dev')).toBe(true);
    expect(await isAllowedTester(teamClient, 'usr_x')).toBe(false);
    vi.spyOn(ClientTester, 'findOne').mockResolvedValue({ sub: 'usr_x' } as never);
    expect(await isAllowedTester(teamClient, 'usr_x')).toBe(true);
  });

  it('lists team ids and publisher names', async () => {
    const find = vi.spyOn(TeamMember, 'find').mockReturnValue(lean([{ team_id: 'team_1' }]));
    expect(await teamIdsFor('usr_a')).toEqual(['team_1']);
    await teamIdsFor('usr_a', ['owner']);
    expect(find).toHaveBeenLastCalledWith({ sub: 'usr_a', role: { $in: ['owner'] } });

    expect(await publisherName(userClient)).toBeNull();
    vi.spyOn(Team, 'findOne').mockReturnValueOnce(lean({ name: 'Robotics' }));
    expect(await publisherName(teamClient)).toBe('Robotics');
    vi.spyOn(Team, 'findOne').mockReturnValueOnce(lean(null));
    expect(await publisherName(teamClient)).toBeNull();
  });
});

describe('teams API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_lead' });
  });

  it('requires a session on every route', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue(null);
    const unauth = [
      await listTeams(request('/api/internal/teams', 'GET')),
      await createTeam(request('/api/internal/teams', 'POST', { name: 'X Club' })),
      await getTeam(request('/api/internal/teams/team_1', 'GET'), TEAM),
      await renameTeam(request('/api/internal/teams/team_1', 'PATCH', { name: 'New' }), TEAM),
      await addMember(request('/m', 'POST', {}), TEAM),
      await changeRole(request('/m', 'PATCH', {}), TEAM),
      await removeMember(request('/m?sub=x', 'DELETE'), TEAM),
    ];
    expect(unauth.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it('lists nothing for users without teams and validates team names', async () => {
    vi.spyOn(TeamMember, 'find').mockReturnValue(lean([]));
    expect(await (await listTeams(request('/api/internal/teams', 'GET'))).json()).toEqual({ teams: [] });
    expect((await createTeam(request('/api/internal/teams', 'POST', { name: 'X' }))).status).toBe(400);
    expect((await createTeam(new NextRequest('http://localhost:3000/api/internal/teams', { method: 'POST', headers: { cookie: 'pesu_session=s' }, body: 'nope' }))).status).toBe(400);
    expect((await renameTeam(request('/t', 'PATCH', { name: 7 }), TEAM)).status).toBe(400);
  });

  it('counts members and apps per team with defaults', async () => {
    vi.spyOn(TeamMember, 'find').mockReturnValue(lean([{ team_id: 'team_1', role: 'owner' }, { team_id: 'team_2', role: 'developer' }]));
    vi.spyOn(Team, 'find').mockReturnValue(sorted([{ team_id: 'team_1', name: 'A', slug: 'a' }, { team_id: 'team_2', name: 'B', slug: 'b' }]));
    vi.spyOn(TeamMember, 'aggregate').mockResolvedValue([{ _id: 'team_1', n: 3 }]);
    vi.spyOn(Client, 'aggregate').mockResolvedValue([{ _id: 'team_2', n: 1 }]);
    const { teams } = await (await listTeams(request('/api/internal/teams', 'GET'))).json();
    expect(teams).toEqual([
      expect.objectContaining({ team_id: 'team_1', role: 'owner', member_count: 3, client_count: 0 }),
      expect.objectContaining({ team_id: 'team_2', role: 'developer', member_count: 0, client_count: 1 }),
    ]);
  });

  it('hides teams from non-members and lets only owners/admins rename', async () => {
    memberRoles({});
    expect((await getTeam(request('/t', 'GET'), TEAM)).status).toBe(404);
    expect((await renameTeam(request('/t', 'PATCH', { name: 'Renamed' }), TEAM)).status).toBe(403);

    memberRoles({ usr_lead: 'admin' });
    const update = vi.spyOn(Team, 'updateOne').mockResolvedValue({} as never);
    expect((await renameTeam(request('/t', 'PATCH', { name: ' Renamed ' }), TEAM)).status).toBe(200);
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { name: 'Renamed' } });
  });

  it('returns members with unknown users tolerated', async () => {
    memberRoles({ usr_lead: 'owner' });
    vi.spyOn(Team, 'findOne').mockReturnValue(lean({ team_id: 'team_1', name: 'A', slug: 'a' }));
    vi.spyOn(TeamMember, 'find').mockReturnValue(sorted([{ sub: 'usr_lead', role: 'owner' }, { sub: 'usr_ghost', role: 'developer' }]));
    vi.spyOn(Client, 'find').mockReturnValue(sorted([]));
    vi.spyOn(User, 'find').mockReturnValue(lean([{ sub: 'usr_lead', name: 'Lead', srn: 'S1' }]));
    const body = await (await getTeam(request('/t', 'GET'), TEAM)).json();
    expect(body.members).toEqual([
      expect.objectContaining({ sub: 'usr_lead', name: 'Lead', srn: 'S1' }),
      expect.objectContaining({ sub: 'usr_ghost', name: null, srn: null }),
    ]);
  });

  it('validates member payloads and targets', async () => {
    memberRoles({ usr_lead: 'owner' });
    expect((await addMember(request('/m', 'POST', { identifier: 'usr_x', role: 'root' }), TEAM)).status).toBe(400);
    expect((await changeRole(request('/m', 'PATCH', { sub: 'usr_x', role: 'boss' }), TEAM)).status).toBe(400);
    expect((await changeRole(request('/m', 'PATCH', { sub: 'usr_x', role: 'admin' }), TEAM)).status).toBe(404);
    expect((await removeMember(request('/m', 'DELETE'), TEAM)).status).toBe(400);
    expect((await removeMember(request('/m?sub=usr_x', 'DELETE'), TEAM)).status).toBe(404);
    expect((await addMember(request('/m', 'POST', { identifier: '' }), TEAM)).status).toBe(400);
    const badJson = new NextRequest('http://localhost:3000/m', { method: 'PATCH', headers: { cookie: 'pesu_session=s' }, body: '{' });
    expect((await changeRole(badJson, TEAM)).status).toBe(400);
    const badPost = new NextRequest('http://localhost:3000/m', { method: 'POST', headers: { cookie: 'pesu_session=s' }, body: '{' });
    expect((await addMember(badPost, TEAM)).status).toBe(400);
  });

  it('adds members and notifies them; developers cannot remove others', async () => {
    memberRoles({ usr_lead: 'owner', usr_dev: 'developer', usr_other: 'developer' });
    vi.spyOn(TeamMember, 'exists').mockResolvedValue(null);
    vi.spyOn(TeamMember, 'create').mockResolvedValue({ sub: 'usr_new', role: 'developer' } as never);
    vi.spyOn(Team, 'findOne').mockReturnValue(lean(null));
    const res = await addMember(request('/m', 'POST', { identifier: 'usr_new' }), TEAM);
    expect(await res.json()).toEqual({ member: { sub: 'usr_new', role: 'developer' } });

    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_dev' });
    expect((await removeMember(request('/m?sub=usr_other', 'DELETE'), TEAM)).status).toBe(403);
    vi.spyOn(TeamMember, 'deleteOne').mockResolvedValue({} as never);
    expect((await removeMember(request('/m?sub=usr_dev', 'DELETE'), TEAM)).status).toBe(200);
  });

  it('lets an owner demote another owner when more than one exists', async () => {
    memberRoles({ usr_lead: 'owner', usr_co: 'owner' });
    vi.spyOn(TeamMember, 'find').mockReturnValue(lean([{ sub: 'usr_lead' }, { sub: 'usr_co' }]));
    const update = vi.spyOn(TeamMember, 'updateOne').mockResolvedValue({} as never);
    expect((await changeRole(request('/m', 'PATCH', { sub: 'usr_co', role: 'admin' }), TEAM)).status).toBe(200);
    expect(update).toHaveBeenCalledWith({ team_id: 'team_1', sub: 'usr_co' }, { $set: { role: 'admin' } });
  });

  it('only lets team owners and admins create team-owned clients', async () => {
    memberRoles({ usr_lead: 'developer' });
    const res = await createClient(request('/api/internal/portal/clients', 'POST', { name: 'App', teamId: 'team_1' }));
    expect(res.status).toBe(403);
    expect((await createClient(request('/api/internal/portal/clients', 'POST', { name: 'App', teamId: 42 }))).status).toBe(403);
  });
});

describe('team page', () => {
  const detail = {
    team: { team_id: 'team_1', name: 'Robotics Club', slug: 'robotics-club' },
    role: 'owner',
    members: [
      { sub: 'usr_lead', role: 'owner', name: 'Lead', srn: 'S1' },
      { sub: 'usr_dev', role: 'developer', name: null, srn: null },
    ],
    clients: [{ client_id: 'cli_1', name: 'Bot Tracker', publishing_status: 'testing' }],
  };

  function mockFetch(overrides: Record<string, { ok: boolean; body: unknown }> = {}) {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const hit = overrides[key];
      if (hit) return { ok: hit.ok, json: async () => hit.body } as Response;
      if (url === '/api/internal/auth/status') return { ok: true, json: async () => ({ sub: 'usr_lead' }) } as Response;
      return { ok: true, json: async () => detail } as Response;
    }) as never;
  }

  beforeEach(() => mockPush.mockReset());

  it('renders members, apps and manages the team', async () => {
    mockFetch();
    render(<TeamPage />);
    expect(await screen.findByText('Robotics Club')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('usr_dev')).toBeDefined();
    expect(screen.getByText('Bot Tracker')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Role for usr_dev'), { target: { value: 'admin' } });
    await waitFor(() => expect(screen.getByText('Role updated')).toBeDefined());

    fireEvent.change(screen.getByLabelText('PRN or SRN of the new member'), { target: { value: 'PES1' } });
    fireEvent.change(screen.getByLabelText('Role for the new member'), { target: { value: 'admin' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
    });
    await waitFor(() => expect(screen.getByText('Member added')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Robo' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    });
    await waitFor(() => expect(screen.getByText('Team renamed')).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove usr_dev' }));
    });
    await waitFor(() => expect(screen.getByText('Member removed')).toBeDefined());
  });

  it('leaves the team and returns to the portal; shows API errors', async () => {
    mockFetch({ 'DELETE /api/internal/teams/team_1/members?sub=usr_lead': { ok: true, body: { success: true } } });
    render(<TeamPage />);
    await screen.findByText('Robotics Club');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave team' }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'));

    mockFetch({ 'PATCH /api/internal/teams/team_1': { ok: false, body: { error: 'Nope' } } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    });
    await waitFor(() => expect(screen.getByText('Nope')).toBeDefined());

    mockFetch({ 'PATCH /api/internal/teams/team_1': { ok: false, body: {} } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    });
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeDefined());
  });

  it('shows a read-only view for developers and a not-found state', async () => {
    global.fetch = vi.fn(async (url: string) =>
      url === '/api/internal/auth/status'
        ? ({ ok: false, json: async () => ({}) } as Response)
        : ({ ok: true, json: async () => ({ ...detail, role: 'developer', clients: [] }) } as Response)
    ) as never;
    const { unmount } = render(<TeamPage />);
    await screen.findByText('Robotics Club');
    expect(screen.queryByLabelText('Team name')).toBeNull();
    expect(screen.getByText(/No apps yet/)).toBeDefined();
    unmount();

    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Team not found' }) }) as Response) as never;
    render(<TeamPage />);
    expect(await screen.findByText('Team not found')).toBeDefined();
  });

  it('falls back to a generic error when the team response has no message', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response) as never;
    render(<TeamPage />);
    expect(await screen.findByText('Team not found')).toBeDefined();
  });

  it('shows load errors after a failed reload', async () => {
    let calls = 0;
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/internal/auth/status') return { ok: true, json: async () => ({ sub: 'usr_lead' }) } as Response;
      calls++;
      if (calls === 1) return { ok: true, json: async () => detail } as Response;
      if (calls === 2) return { ok: true, json: async () => ({ success: true }) } as Response;
      return { ok: false, json: async () => ({}) } as Response;
    }) as never;
    render(<TeamPage />);
    await screen.findByText('Robotics Club');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    });
    await waitFor(() => expect(screen.getByText('Team not found')).toBeDefined());
  });
});

describe('portal teams section', () => {
  it('lists teams, creates one, and offers team ownership for new apps', async () => {
    const teams = [{ team_id: 'team_1', name: 'Robotics Club', slug: 'r', role: 'owner', member_count: 1, client_count: 1 }];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/internal/teams' && init?.method === 'POST') {
        return { ok: !(JSON.parse(String(init.body)).name === 'bad'), json: async () => ({ error: 'Team name must be 2–60 characters' }) } as Response;
      }
      if (url === '/api/internal/teams') return { ok: true, json: async () => ({ teams }) } as Response;
      return {
        ok: true,
        json: async () => ({
          clients: [{ client_id: 'cli_1', name: 'Bot', publishing_status: 'testing', redirect_uris: [], owner_type: 'team', owner_team_id: 'team_1' }],
        }),
      } as Response;
    }) as never;

    render(<PortalPage />);
    expect(await screen.findByText('1 member · 1 app')).toBeDefined();
    expect(screen.getAllByText('Robotics Club').length).toBeGreaterThan(1); // card badge + team list

    fireEvent.change(screen.getByLabelText('New team name'), { target: { value: 'Chess Club' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /new team/i }));
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/internal/teams', expect.objectContaining({ method: 'POST' }));

    fireEvent.change(screen.getByLabelText('New team name'), { target: { value: 'bad' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /new team/i }));
    });
    expect(await screen.findByText('Team name must be 2–60 characters')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /register application/i }));
    const owner = await screen.findByLabelText('Owner');
    fireEvent.change(owner, { target: { value: 'team_1' } });
    expect((owner as HTMLSelectElement).value).toBe('team_1');
  });
});
