import type { IncomingMessage, ServerResponse } from 'node:http';
export function createVercelHandler(
  env: Record<string, string | undefined>,
  tables: unknown[],
  root: string,
): Promise<(req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<unknown>>;
