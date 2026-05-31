// Moved to api/auth/google/callback.js
export default function handler(req, res) {
  res.status(404).json({ error: 'Not found — use /api/auth/google/callback' })
}
