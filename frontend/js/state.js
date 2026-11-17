// Shared mutable app state, replacing the old sibling top-level `let`s.
export const state = {
    pendingTheme: null,
    pendingBuddy: null,
    calendar: undefined,
    currentUser: JSON.parse(localStorage.getItem('nexusUser') || 'null'),
    lastBuddyState: null,
    authMode: 'signin',
    currentOpenedTaskId: null,
    layoutInitialized: false,
    currentImportPreview: null,
    currentOpenedCourseId: null,
    aiConfigured: true,       // the built-in assistant is configured, or the user has a key of their own
    serverAiConfigured: true, // the built-in assistant alone (from /api/ai/status)
    aiDailyLimit: 0,          // built-in AI requests per user per day (0 = unknown or no limit)
    lastLoadedTasks: [],
};
