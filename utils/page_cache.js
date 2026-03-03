const cache = new Map();

function getCache(key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (typeof ttlMs === "number" && ttlMs >= 0) {
    if (Date.now() - entry.timestamp > ttlMs) {
      cache.delete(key);
      return null;
    }
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

function deleteCache(key) {
  cache.delete(key);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  getCache,
  setCache,
  deleteCache,
  clearCache,
};
