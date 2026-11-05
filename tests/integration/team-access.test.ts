import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { GET as listTeams, POST as createTeam } from '@/app/api/internal/teams/route';
import { GET as getTeam } from '@/app/api/internal/teams/[teamId]/route';
import { POST as addMember, PATCH as changeRole, DELETE as removeMember } from '@/app/api/internal/teams/[teamId]/members/route';
import { GET as listClients, POST as createClient } from '@/app/api/internal/portal/clients/route';
import { GET as getClient, PATCH as patchClient } from '@/app/api/internal/portal/clients/[clientId]/route';
import { POST as rotateSecret } from '@/app/api/internal/portal/clients/[clientId]/rotate-secret/route';
import { isAllowedTester, publisherName } from '@/lib/authz/client-access';
import { Client, User } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';

async function as(sub: string) {
  return `pesu_session=${await createSessionToken({ sub })}`;
}

function req(url: string, method: string, cookie: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Team ownership of clients (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
    await User.create([
      { sub: 'usr_lead', name: 'Club Lead', prn: 'PES1UG20CS401', srn: 'PES1UG20CS401' },
      { sub: 'usr_dev', name: 'Club Dev', prn: 'PES1UG20CS402', srn: 'PES1UG20CS402' },
      { sub: 'usr_outsider', name: 'Outsider', prn: 'PES1UG20CS403', srn: 'PES1UG20CS403' },
    ]);
  });

  it('shares a team-owned app with role-based permissions', async () => {
    const lead = await as('usr_lead');
    const dev = await as('usr_dev');
    const outsider = await as('usr_outsider');

    // Lead creates a team (slug de-duplicated) and a team-owned app
    const team = (await (await createTeam(req('/api/internal/teams', 'POST', lead, { name: 'Robotics Club' }))).json()).team;
    expect(team).toMatchObject({ name: 'Robotics Club', slug: 'robotics-club', role: 'owner' });
    const second = (await (await createTeam(req('/api/internal/teams', 'POST', lead, { name: 'Robotics  Club!' }))).json()).team;
    expect(second.slug).toBe('robotics-club-2');

    const created = await createClient(req('/api/internal/portal/clients', 'POST', lead, { name: 'Bot Tracker', teamId: team.team_id }));
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.client).not.toHaveProperty('client_secret_hash');
    const clientId = createdBody.client.client_id;

    // Outsiders cannot create apps for the team or see it
    expect((await createClient(req('/api/internal/portal/clients', 'POST', outsider, { name: 'X', teamId: team.team_id }))).status).toBe(403);
    const params = { params: Promise.resolve({ clientId }) };
    expect((await getClient(req(`/api/internal/portal/clients/${clientId}`, 'GET', outsider), params)).status).toBe(404);

    // Lead adds the developer by SRN; the developer now sees the app in their list
    expect((await addMember(req(`/api/internal/teams/${team.team_id}/members`, 'POST', lead, { identifier: 'PES1UG20CS402' }), { params: Promise.resolve({ teamId: team.team_id }) })).status).toBe(200);
    const devClients = (await (await listClients(req('/api/internal/portal/clients', 'GET', dev))).json()).clients;
    expect(devClients.map((c: { client_id: string }) => c.client_id)).toEqual([clientId]);
    expect(devClients[0]).not.toHaveProperty('client_secret_hash');

    // Developer can edit, but not rotate secrets; permissions are reported to the UI
    const devView = await (await getClient(req(`/api/internal/portal/clients/${clientId}`, 'GET', dev), params)).json();
    expect(devView.permissions).toEqual({ secrets: false, publish: false });
    expect(devView.team).toMatchObject({ name: 'Robotics Club' });
    expect((await patchClient(req(`/api/internal/portal/clients/${clientId}`, 'PATCH', dev, { redirectUris: ['https://bots.pesu.dev/cb'] }), params)).status).toBe(200);
    expect((await rotateSecret(req(`/api/internal/portal/clients/${clientId}/rotate-secret`, 'POST', dev), params)).status).toBe(404);
    expect((await rotateSecret(req(`/api/internal/portal/clients/${clientId}/rotate-secret`, 'POST', lead), params)).status).toBe(200);

    // Members count as testers while Testing; outsiders do not. Consent shows the team.
    const client = (await Client.findOne({ client_id: clientId }))!;
    expect(await isAllowedTester(client, 'usr_dev')).toBe(true);
    expect(await isAllowedTester(client, 'usr_outsider')).toBe(false);
    expect(await publisherName(client)).toBe('Robotics Club');

    // Team listing reports counts
    const teams = (await (await listTeams(req('/api/internal/teams', 'GET', dev))).json()).teams;
    expect(teams).toEqual([expect.objectContaining({ name: 'Robotics Club', role: 'developer', member_count: 2, client_count: 1 })]);
  });

  it('enforces membership rules and keeps at least one owner', async () => {
    const lead = await as('usr_lead');
    const dev = await as('usr_dev');
    const team = (await (await createTeam(req('/api/internal/teams', 'POST', lead, { name: 'Coding Club' }))).json()).team;
    const p = { params: Promise.resolve({ teamId: team.team_id }) };
    const members = `/api/internal/teams/${team.team_id}/members`;

    await addMember(req(members, 'POST', lead, { identifier: 'usr_dev', role: 'admin' }), p);
    // Admins cannot create owners or demote the owner
    expect((await addMember(req(members, 'POST', dev, { identifier: 'PES1UG20CS403', role: 'owner' }), p)).status).toBe(403);
    expect((await changeRole(req(members, 'PATCH', dev, { sub: 'usr_lead', role: 'developer' }), p)).status).toBe(403);
    // Duplicate and unknown people
    expect((await addMember(req(members, 'POST', lead, { identifier: 'usr_dev' }), p)).status).toBe(409);
    expect((await addMember(req(members, 'POST', lead, { identifier: 'PES9NOTREAL' }), p)).status).toBe(400);

    // The only owner cannot leave or be demoted
    expect((await removeMember(req(`${members}?sub=usr_lead`, 'DELETE', lead), p)).status).toBe(400);
    expect((await changeRole(req(members, 'PATCH', lead, { sub: 'usr_lead', role: 'admin' }), p)).status).toBe(400);

    // After promoting another owner, the lead can leave
    expect((await changeRole(req(members, 'PATCH', lead, { sub: 'usr_dev', role: 'owner' }), p)).status).toBe(200);
    expect((await removeMember(req(`${members}?sub=usr_lead`, 'DELETE', lead), p)).status).toBe(200);
    expect((await getTeam(req(`/api/internal/teams/${team.team_id}`, 'GET', lead), p)).status).toBe(404);
    const detail = await (await getTeam(req(`/api/internal/teams/${team.team_id}`, 'GET', dev), p)).json();
    expect(detail.members).toEqual([expect.objectContaining({ sub: 'usr_dev', role: 'owner', name: 'Club Dev' })]);
  });
});
