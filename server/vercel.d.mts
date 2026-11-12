import type { IncomingMessage, ServerResponse } from 'node:http';
export function createLoginThrottle(options?: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}): {
  blocked(ip: string): boolean;
  fail(ip: string): void;
  clear(ip: string): void;
};
export function createVercelHandler(
  env: Record<string, string | undefined>,
  tables: unknown[],
  root: string,
): Promise<(req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<unknown>>;
