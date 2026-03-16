/**
 * Tracks active regular-user sessions for concurrent user limiting and 10-minute expiry.
 * Super Admin and Admin roles are exempt (not counted, no expiry).
 */

const MAX_CONCURRENT_USERS = parseInt(process.env.MAX_CONCURRENT_USERS || '200', 10);
const SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '10', 10);
const SESSION_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000;

/** Map: userId -> { loginTime, expiresAt } */
const sessions = new Map();

const EXEMPT_ROLE_NAMES = ['Super Admin', 'Admin'];

export function isExemptRole(roleName) {
  if (typeof roleName !== 'string') return false;
  return EXEMPT_ROLE_NAMES.includes(roleName.trim());
}

export function isExemptRoleNames(roleNames) {
  if (!Array.isArray(roleNames)) return false;
  return roleNames.some((name) => isExemptRole(name));
}

export function canRegularUserLogin() {
  return sessions.size < MAX_CONCURRENT_USERS;
}

export function registerSession(userId) {
  const now = Date.now();
  sessions.set(String(userId), { loginTime: now, expiresAt: now + SESSION_MS });
  console.log(`[sessionTracker] Regular user logged in, active count: ${sessions.size}`);
}

export function removeSession(userId) {
  if (sessions.delete(String(userId))) {
    console.log(`[sessionTracker] Regular user session removed, active count: ${sessions.size}`);
  }
}

export function getSessionExpiry(userId) {
  const entry = sessions.get(String(userId));
  if (!entry) return null;
  const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

function cleanupExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [userId, entry] of sessions.entries()) {
    if (now >= entry.expiresAt) {
      sessions.delete(userId);
      removed++;
    }
  }
  if (removed > 0 || sessions.size > 0) {
    console.log(`[sessionTracker] Cleanup: removed ${removed} expired, active count: ${sessions.size}`);
  }
}

const CLEANUP_INTERVAL_MS = 60 * 1000;
setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
