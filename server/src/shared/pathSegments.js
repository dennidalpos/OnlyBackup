function sanitizePathSegment(value, fallback = '') {
  const raw = value || fallback;
  return raw.toString().replace(/[^a-zA-Z0-9._-]/g, '_');
}

module.exports = {
  sanitizePathSegment
};
