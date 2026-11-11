// Short-lived caches for metadata and column configuration on the local server.

const CONFIG_PATHS = new Set(['/api/formula-config', '/api/admin/schema/apply']);

// Only endpoints that change configuration or schema invalidate the caches.
// Writing table rows never does, so repeated cell edits reuse cached config.
export function invalidatesCaches(method, pathname) {
  if (method === 'GET' || method === 'HEAD') return false;
  return (
    CONFIG_PATHS.has(pathname) || pathname.startsWith('/api/lookup-config') || pathname.startsWith('/api/lookup-sync/')
  );
}

export function createTtlCache(ttl = 60000, now = () => Date.now()) {
  const entries = new Map();
  async function get(key, read) {
    const entry = entries.get(key);
    if (entry && now() - entry.time < ttl) return entry.value;
    const value = Promise.resolve().then(read);
    const fresh = { time: now(), value };
    entries.set(key, fresh);
    try {
      return await value;
    } catch (error) {
      if (entries.get(key) === fresh) entries.delete(key);
      throw error;
    }
  }
  function clear() {
    entries.clear();
  }
  return { get, clear };
}
