// No build step: pick the backend origin at runtime based on where the frontend is served from.
export const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8081'
    : 'https://REPLACE_WITH_DEPLOYED_BACKEND_URL';
