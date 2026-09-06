/**
 * Redux store configuration.
 *
 * PERFORMANCE FIX: Debounced AsyncStorage persistence.
 *
 * Previously every Redux action (appendMessage, updateMessageStatus, etc.) was
 * calling JSON.stringify(ENTIRE messagesMap) synchronously inside the reducer,
 * blocking the JS thread on every single incoming socket event.
 *
 * Now: a custom middleware fires a debounced writer (1500 ms) that serializes
 * state ONCE after a burst of actions settles, using requestAnimationFrame to
 * yield to the render thread first. Upload-progress updates are excluded from
 * persistence entirely (they are ephemeral UI state).
 */
import { configureStore, Middleware } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import chatReducer, { CHAT_STORAGE_KEYS } from './chatSlice';
import { safeStorage } from '../services/storageHelper';

// ─── Debounced persistence middleware ────────────────────────────────────────

// Actions that mutate ONLY ephemeral state — no need to persist at all.
const SKIP_PERSIST_ACTIONS = new Set([
  'chat/updateMessageProgress',
  'chat/setActiveConversationId',
]);

// Actions that only touch conversations, not messages — cheaper to persist.
const CONV_ONLY_ACTIONS = new Set([
  'chat/setConversations',
  'chat/addConversation',
  'chat/removeConversation',
  'chat/clearConversationMessages',
]);

let persistConvTimer: ReturnType<typeof setTimeout> | null = null;
let persistMsgTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistedConvs: string | null = null;
let lastPersistedMsgs: string | null = null;

const DEBOUNCE_MS = 1500; // 1.5s — coalesces rapid bursts into one write

function scheduleConvPersist(getState: () => any) {
  if (persistConvTimer) clearTimeout(persistConvTimer);
  persistConvTimer = setTimeout(() => {
    persistConvTimer = null;
    // Yield to the React render thread before the heavy JSON.stringify
    requestAnimationFrame(() => {
      const conversations = getState().chat.conversations;
      const serialized = JSON.stringify(conversations);
      if (serialized !== lastPersistedConvs) {
        lastPersistedConvs = serialized;
        safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, serialized).catch(() => {});
      }
    });
  }, DEBOUNCE_MS);
}

function scheduleMsgPersist(getState: () => any) {
  if (persistMsgTimer) clearTimeout(persistMsgTimer);
  persistMsgTimer = setTimeout(() => {
    persistMsgTimer = null;
    requestAnimationFrame(() => {
      const messagesMap = getState().chat.messagesMap;
      const serialized = JSON.stringify(messagesMap);
      if (serialized !== lastPersistedMsgs) {
        lastPersistedMsgs = serialized;
        safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, serialized).catch(() => {});
      }
    });
  }, DEBOUNCE_MS);
}

const debouncedPersistenceMiddleware: Middleware = (storeApi) => (next) => (action: any) => {
  const result = next(action); // Let reducers run first
  const type: string = action?.type ?? '';

  if (!type.startsWith('chat/') || SKIP_PERSIST_ACTIONS.has(type)) {
    return result;
  }

  if (CONV_ONLY_ACTIONS.has(type)) {
    scheduleConvPersist(storeApi.getState);
  } else {
    // Messages + conversations may both have changed
    scheduleMsgPersist(storeApi.getState);
    scheduleConvPersist(storeApi.getState);
  }

  return result;
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(debouncedPersistenceMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
