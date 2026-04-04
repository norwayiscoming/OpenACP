import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { JwtPayload } from './types.js';

export interface SignPayload {
  sub: string;
  role: string;
  scopes?: string[];
  rfd: number;
}

export function signToken(payload: SignPayload, secret: string, expiresIn: string): string {
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, opts);
}

export function verifyToken(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
}

export function verifyForRefresh(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret, { algorithms: ['HS256'], ignoreExpiration: true }) as JwtPayload;
}
