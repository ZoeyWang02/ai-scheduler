import { getUserId } from './auth.js';

/* Saved chat conversations, kept in this browser (localStorage), one list per signed-in
   user ("guest" when signed out). Pure storage: rendering lives in chat.js.

   conversation: { id, title, createdAt, updatedAt, messages: [message] }
   message:      { id, role: 'user' | 'ai' | 'plan', text, error?, plan?, request?, applied? }
     - 'plan' messages carry the AI's JSON plan (string) and the user request it answered. */

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;
const TITLE_LENGTH = 28;

function storageKey() {
    const id = getUserId();
    return `nexusChats:${id ? id : 'guest'}`;
}

function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function loadConversations() {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey()) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveConversations(list) {
    const trimmed = list
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_CONVERSATIONS);
    try {
        localStorage.setItem(storageKey(), JSON.stringify(trimmed));
    } catch (e) {
        // Storage full or blocked: the live chat keeps working, it just won't be remembered.
        console.warn('Could not save chat history', e);
    }
}

export function getConversation(id) {
    return loadConversations().find(c => c.id === id) || null;
}

export function titleFrom(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > TITLE_LENGTH ? flat.slice(0, TITLE_LENGTH) + '…' : flat;
}

/** Adds a message to a conversation, creating the conversation when `conversationId` is
 *  missing or unknown (e.g. after signing in as another user). Returns { conversationId, messageId }. */
export function addMessage(conversationId, message) {
    const list = loadConversations();
    let conversation = list.find(c => c.id === conversationId);
    if (!conversation) {
        conversation = { id: newId('c'), title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        list.push(conversation);
    }
    const stored = { id: newId('m'), ...message };
    conversation.messages.push(stored);
    if (conversation.messages.length > MAX_MESSAGES) conversation.messages.shift();
    if (!conversation.title && message.role === 'user') conversation.title = titleFrom(message.text);
    conversation.updatedAt = Date.now();
    saveConversations(list);
    return { conversationId: conversation.id, messageId: stored.id };
}

export function updateMessage(conversationId, messageId, patch) {
    const list = loadConversations();
    const conversation = list.find(c => c.id === conversationId);
    const message = conversation && conversation.messages.find(m => m.id === messageId);
    if (!message) return;
    Object.assign(message, patch);
    saveConversations(list);
}

export function deleteConversation(id) {
    saveConversations(loadConversations().filter(c => c.id !== id));
}
