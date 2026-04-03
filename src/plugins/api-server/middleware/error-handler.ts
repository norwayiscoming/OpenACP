import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ConfigValidationError } from '../../../core/config/config-registry.js';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  };
}

export class NotFoundError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class ServiceUnavailableError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function globalErrorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.errors.map((e) => e.message).join(', '),
        statusCode: 400,
        details: error.errors,
      },
    });
    return;
  }

  if (error instanceof ConfigValidationError) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        statusCode: 400,
      },
    });
    return;
  }

  if (error instanceof BadRequestError) {
    reply.status(400).send({
      error: {
        code: error.code,
        message: error.message,
        statusCode: 400,
      },
    });
    return;
  }

  if (error instanceof NotFoundError) {
    reply.status(404).send({
      error: {
        code: error.code,
        message: error.message,
        statusCode: 404,
      },
    });
    return;
  }

  if (error instanceof ServiceUnavailableError) {
    reply.status(503).send({
      error: {
        code: error.code,
        message: error.message,
        statusCode: 503,
      },
    });
    return;
  }

  if (error instanceof AuthError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
      },
    });
    return;
  }

  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      statusCode: 500,
    },
  });
}
