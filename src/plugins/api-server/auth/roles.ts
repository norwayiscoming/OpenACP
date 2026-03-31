export const ROLES = {
  admin: ['*'],
  operator: [
    'sessions:read', 'sessions:write', 'sessions:prompt', 'sessions:permission',
    'agents:read', 'commands:execute', 'system:health',
  ],
  viewer: ['sessions:read', 'agents:read', 'system:health'],
} as const;

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
