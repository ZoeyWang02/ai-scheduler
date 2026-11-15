// No build step: pick the backend origin at runtime based on where the frontend is served from.
// In production the backend serves this frontend from its own origin (the Spring Boot jar, or the
// Cloudflare Worker's static assets), so the API is reached with same-origin relative URLs.
// The one exception is the local static preview server (:8099), which has no API of its own and
// talks to the Java backend on :8081.
export const API_BASE = ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '8099')
    ? 'http://localhost:8081'
    : '';
