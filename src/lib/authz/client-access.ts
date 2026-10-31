import { Client, ClientTester, Team, TeamMember, type IClient, type TeamRole } from '@/lib/db/models';

/**
 * Who may manage an OAuth client. User-owned clients belong to their creator; team-owned
 * clients are shared by the team's members according to role.
 */
export type ClientAction =
  | 'view'
  | 'edit' // redirect URIs, device flow toggle
  | 'testers'
  | 'secrets'
  | 'publish'; // request Production / API scopes

const TEAM_PERMISSIONS: Record<TeamRole, readonly ClientAction[]> = {
  owner: ['view', 'edit', 'testers', 'secrets', 'publish'],
  admin: ['view', 'edit', 'testers', 'secrets', 'publish'],
  developer: ['view', 'edit', 'testers'],
};

type ClientOwnership = Pick<IClient, 'owner_sub' | 'owner_type' | 'owner_team_id'>;

function isTeamOwned(client: ClientOwnership): client is ClientOwnership & { owner_team_id: string } {
  return client.owner_type === 'team' && Boolean(client.owner_team_id);
}

export async function getTeamRole(teamId: string, sub: string): Promise<TeamRole | null> {
  const member = await TeamMember.findOne({ team_id: teamId, sub }).lean();
  return member?.role ?? null;
}

export function roleAllows(role: TeamRole | null, action: ClientAction): boolean {
  return role ? TEAM_PERMISSIONS[role].includes(action) : false;
}

export async function canManageClient(sub: string, client: ClientOwnership, action: ClientAction): Promise<boolean> {
  if (isTeamOwned(client)) {
    return roleAllows(await getTeamRole(client.owner_team_id, sub), action);
  }
  return client.owner_sub === sub;
}

/** Loads a client only if `sub` may perform `action` on it; otherwise null (callers answer 404). */
export async function findManageableClient(clientId: string, sub: string, action: ClientAction) {
  const client = await Client.findOne({ client_id: clientId });
  if (!client) return null;
  return (await canManageClient(sub, client, action)) ? client : null;
}

/**
 * The Testing allowlist: the owner (or any member of the owning team) and explicit testers.
 */
export async function isAllowedTester(client: ClientOwnership & Pick<IClient, 'client_id'>, sub: string): Promise<boolean> {
  if (isTeamOwned(client)) {
    if (await getTeamRole(client.owner_team_id, sub)) return true;
  } else if (client.owner_sub === sub) {
    return true;
  }
  return Boolean(await ClientTester.findOne({ client_id: client.client_id, sub }));
}

/** Team ids where `sub` holds one of `roles` (all roles by default). */
export async function teamIdsFor(sub: string, roles?: TeamRole[]): Promise<string[]> {
  const filter: Record<string, unknown> = { sub };
  if (roles) filter.role = { $in: roles };
  const rows = await TeamMember.find(filter).lean();
  return rows.map((r) => r.team_id);
}

/** Display name of the publisher for consent screens: the team name, or null for user-owned. */
export async function publisherName(client: ClientOwnership): Promise<string | null> {
  if (!isTeamOwned(client)) return null;
  const team = await Team.findOne({ team_id: client.owner_team_id }).lean();
  return team?.name ?? null;
}
