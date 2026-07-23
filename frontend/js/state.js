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
    aiConfigured: true,
    lastLoadedTasks: [],
};
