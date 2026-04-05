// sessions:dangerous is intentionally not assigned to any named role.
// Only admin (via wildcard '*') has it. Operators must be explicitly granted it.
export const ROLES = {
  admin: ['*'],
  operator: [
    'sessions:read', 'sessions:write', 'sessions:prompt', 'sessions:permission',
    'agents:read', 'agents:write', 'commands:execute', 'system:health', 'config:read',
  ],
  viewer: ['sessions:read', 'agents:read', 'system:health'],
} as const;

// Known scopes — used for documentation and validation.
// sessions:dangerous grants access to destructive session operations.
// agents:write grants access to agent catalog management (e.g. reload).
export const KNOWN_SCOPES = [
  'sessions:read', 'sessions:write', 'sessions:prompt', 'sessions:permission', 'sessions:dangerous',
  'agents:read', 'agents:write', 'commands:execute', 'system:health', 'config:read',
] as const;

export type RoleName = keyof typeof ROLES;

export function isValidRole(role: string): role is RoleName {
  return role in ROLES;
}

export function getRoleScopes(role: string): string[] {
  if (!isValidRole(role)) return [];
  return [...ROLES[role]];
}

export function hasScope(userScopes: string[], requiredScope: string): boolean {
  if (userScopes.includes('*')) return true;
  return userScopes.includes(requiredScope);
}
