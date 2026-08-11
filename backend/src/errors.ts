import type { FastifyReply, FastifyRequest } from 'fastify';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(error: unknown, _req: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return;
  }
  const status = (error as { statusCode?: number })?.statusCode ?? 500;
  if (status >= 500) {
    console.error(error);
  }
  const message = status >= 500 ? 'Internal server error' : (error as Error).message;
  reply.status(status).send({ error: { code: 'REQUEST_FAILED', message } });
}

export const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Recurso no encontrado');
