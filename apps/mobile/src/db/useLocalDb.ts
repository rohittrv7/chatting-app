/**
 * useLocalDb.ts — React hooks for reactive SQLite queries.
 *
 * These hooks replace the Redux-based conversation and message state in
 * ConversationListScreen and ChatScreen, making the UI genuinely local-first:
 * data comes from the on-device SQLite database, not from Redux/network.
 *
 * How reactivity works:
 *   expo-sqlite's addDatabaseChangeListener fires with {tableName, rowId}
 *   after every INSERT/UPDATE/DELETE. The hooks subscribe to this listener,
 *   filter by table name, and re-query the database when relevant changes land.
 *   This gives WhatsApp-style instant UI updates from the local DB.
 *
 * Redux is kept alongside for:
 *   - Transient UI state (typing indicators, presence, loading flags)
 *   - Optimistic bubble tracking (isUploading, uploadProgress)
 *   - Socket event orchestration (still dispatched to Redux for ChatContext)
 *
 * Usage:
 *   // In ConversationListScreen:
 *   const { conversations, isLoading } = useLocalConversations();
 *
 *   // In ChatScreen:
 *   const { messages, isLoading } = useLocalMessages(conversationId);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDatabase, subscribeToDbChanges } from './database';
import { getConversations, getMessages, convRowToItem, msgRowToChat } from './localDb';
import type { ChatMessage, ConversationItem } from '../types';

// ─── useLocalConversations ────────────────────────────────────────────────────

export interface UseLocalConversationsResult {
  conversations: ConversationItem[];
  isLoading: boolean;
  /** Force a manual refresh (e.g. after server sync) */
  refresh: () => Promise<void>;
}

/**
 * Reactive list of all conversations sorted by most-recent message.
 * Auto-updates when any conversation or message row changes.
 */
export function useLocalConversations(): UseLocalConversationsResult {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMounted = useRef(true);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      if (isMounted.current) {
        setConversations(data);
        setIsLoading(false);
      }
    } catch (e) {
      console.warn('[useLocalConversations] fetch error:', e);
      if (isMounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    // Initial load — must wait for DB to be ready
    getDatabase()
      .then(() => fetchConversations())
      .catch(() => {
        if (isMounted.current) setIsLoading(false);
      });

    // Subscribe to DB changes
    const unsubscribe = subscribeToDbChanges((event) => {
      // Re-query when conversations OR messages change
      // (messages table changes affect lastMessage / time on conversation list)
      if (event.tableName === 'conversations' || event.tableName === 'messages') {
        fetchConversations();
      }
    });

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [fetchConversations]);

  return { conversations, isLoading, refresh: fetchConversations };
}

// ─── useLocalMessages ─────────────────────────────────────────────────────────

export interface UseLocalMessagesResult {
  messages: ChatMessage[];
  isLoading: boolean;
  /** Force a manual refresh (e.g. after server historical load) */
  refresh: () => Promise<void>;
}

/**
 * Reactive list of messages for a single conversation.
 * Auto-updates when any row in the messages table changes.
 *
 * @param conversationServerId — the server-side UUID of the conversation
 */
export function useLocalMessages(conversationServerId: string | undefined): UseLocalMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMounted = useRef(true);
  const convIdRef = useRef(conversationServerId);
  convIdRef.current = conversationServerId;

  const fetchMessages = useCallback(async () => {
    const convId = convIdRef.current;
    if (!convId) {
      if (isMounted.current) {
        setMessages([]);
        setIsLoading(false);
      }
      return;
    }
    try {
      const data = await getMessages(convId, 500);
      if (isMounted.current) {
        setMessages(data);
        setIsLoading(false);
      }
    } catch (e) {
      console.warn('[useLocalMessages] fetch error:', e);
      if (isMounted.current) setIsLoading(false);
    }
  }, []); // stable — convIdRef handles the current value

  useEffect(() => {
    isMounted.current = true;
    setIsLoading(true);

    getDatabase()
      .then(() => fetchMessages())
      .catch(() => {
        if (isMounted.current) setIsLoading(false);
      });

    const unsubscribe = subscribeToDbChanges((event) => {
      if (event.tableName === 'messages') {
        fetchMessages();
      }
    });

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [conversationServerId, fetchMessages]); // re-mount when conversation changes

  return { messages, isLoading, refresh: fetchMessages };
}

// ─── useDbReady ───────────────────────────────────────────────────────────────

/**
 * Returns true once the SQLite database has been opened and migrated.
 * Use this to show a loading state while DB initialises on first app launch.
 */
export function useDbReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getDatabase()
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, []);
  return ready;
}
