import type { Route } from '@playwright/test';

export const csrfToken = 'csrf';

export function metaBody(tables: unknown[], extra: Record<string, unknown> = {}) {
  return { tables, token: csrfToken, ...extra };
}

// Answers the two configuration requests every page makes. Returns false when
// the route belongs to the test itself.
export async function answerConfig(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/formula-config') {
    await route.fulfill({ json: { items: [] } });
    return true;
  }
  if (path === '/api/lookup-config') {
    await route.fulfill({ json: { available: false, items: [] } });
    return true;
  }
  return false;
}
