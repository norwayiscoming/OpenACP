export interface StoredToken {
  id: string;
  name: string;
  role: string;
  scopes?: string[];
  createdAt: string;
  refreshDeadline: string;
  lastUsedAt?: string;
  revoked: boolean;
}

export interface JwtPayload {
  sub: string;
  role: string;
  scopes?: string[];
  iat: number;
  exp: number;
  rfd: number;
}

export interface CreateTokenOpts {
  role: string;
  name: string;
  expire: string;
  scopes?: string[];
}

export interface TokenInfo {
  tokenId: string;
  accessToken: string;
  expiresAt: string;
  refreshDeadline: string;
}
