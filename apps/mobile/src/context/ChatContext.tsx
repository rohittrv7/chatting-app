import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversationItem, ChatMessage, UserProfile } from '../types';
import { socketService } from '../services/socket';

interface ChatContextType {
  userProfile: UserProfile;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  conversations: ConversationItem[];
  messagesMap: Record<string, ChatMessage[]>;
  addMessage: (conversationId: string, text: string, isMe?: boolean, imagePath?: string) => void;
  addConversation: (title: string, username?: string) => void;
  updateLastMessage: (conversationId: string, text: string) => void;
}

const defaultUserProfile: UserProfile = {
  name: '',
  username: '',
  status: 'Available | Let’s chat 🚀',
  phone: '+91 98765 43210',
};

const initialConversations: ConversationItem[] = [
  {
    id: 'conv_alex',
    title: 'Alex Morgan',
    username: '@alex_morgan',
    lastMessage: 'Are we meeting today?',
    time: '9:30 AM',
    unread: '1',
    avatar: 'A',
    isOnline: true,
  },
  {
    id: 'conv_sara',
    title: 'Sara Johnson',
    username: '@sara_j',
    lastMessage: 'Yeah, that works for me!',
    time: '8:58 AM',
    unread: '0',
    avatar: 'S',
    isOnline: false,
  },
  {
    id: 'conv_mike',
    title: 'Michael Smith',
    username: '@michael_s',
    lastMessage: 'Can you send the file?',
    time: 'Yesterday',
    unread: '0',
    avatar: 'M',
    isOnline: true,
  },
  {
    id: 'conv_emily',
    title: 'Emily Davis',
    username: '@emily_d',
    lastMessage: 'Thanks a lot! 😇',
    time: 'Tuesday',
    unread: '0',
    avatar: 'E',
    isOnline: false,
  },
];

const initialMessages: Record<string, ChatMessage[]> = {
  conv_alex: [
    {
      id: 'm1',
      conversationId: 'conv_alex',
      text: "Hey! How's the project going?",
      isMe: false,
      time: '9:20 AM',
      status: 'READ',
    },
    {
      id: 'm2',
      conversationId: 'conv_alex',
      text: "It's going great! Almost done with the new design.",
      isMe: true,
      time: '9:21 AM',
      status: 'READ',
    },
    {
      id: 'm3',
      conversationId: 'conv_alex',
      text: "That's awesome! Can't wait to see it.",
      isMe: false,
      time: '9:22 AM',
      status: 'READ',
    },
    {
      id: 'm4',
      conversationId: 'conv_alex',
      text: 'New_Design.fig',
      isFile: true,
      fileSize: '12.4 MB',
      isMe: false,
      time: '9:23 AM',
      status: 'READ',
    },
    {
      id: 'm5',
      conversationId: 'conv_alex',
      text: 'Here you go! Let me know what you think.',
      isMe: true,
      time: '9:24 AM',
      status: 'READ',
    },
  ],
};

const ChatContext = createContext<ChatContextType>({
  userProfile: defaultUserProfile,
  updateUserProfile: () => {},
  conversations: [],
  messagesMap: {},
  addMessage: () => {},
  addConversation: () => {},
  updateLastMessage: () => {},
});

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  const [conversations, setConversations] = useState<ConversationItem[]>(initialConversations);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>(initialMessages);

  useEffect(() => {
    socketService.connect((convId, sender, text) => {
      addMessage(convId, text, false);
      updateLastMessage(convId, text);
    });

    // Load stored user profile on boot
    AsyncStorage.getItem('@whatsapp_connect_user_profile').then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          setUserProfile(parsed);
        } catch (e) {}
      }
    });

    return () => {
      socketService.disconnect();
    };
  }, []);

  const updateUserProfile = (profile: Partial<UserProfile>) => {
    setUserProfile((prev) => {
      const updated = { ...prev, ...profile };
      AsyncStorage.setItem('@whatsapp_connect_user_profile', JSON.stringify(updated));
      return updated;
    });
  };

  const addMessage = (conversationId: string, text: string, isMe: boolean = true, imagePath?: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      conversationId,
      text,
      isMe,
      time: timeStr,
      status: 'SERVER_RECEIVED',
      imagePath,
    };

    setMessagesMap((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), newMsg],
    }));

    if (isMe) {
      socketService.sendMessage(conversationId, userProfile.name, text);
    }
  };

  const updateLastMessage = (conversationId: string, text: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    setConversations((prev) =>
      prev.map((item) => {
        if (item.id === conversationId || item.title.toLowerCase() === conversationId.toLowerCase()) {
          return { ...item, lastMessage: text, time: timeStr, unread: '0' };
        }
        return item;
      })
    );
  };

  const addConversation = (title: string, username?: string) => {
    const existing = conversations.find((c) => c.title.toLowerCase() === title.toLowerCase());
    if (!existing) {
      const generatedUsername = username || `@${title.toLowerCase().replace(/\s+/g, '_')}`;
      const newConv: ConversationItem = {
        id: `conv_${Date.now()}`,
        title,
        username: generatedUsername,
        lastMessage: 'Tap to start end-to-end encrypted chat',
        time: 'Just now',
        unread: '0',
        avatar: title ? title[0].toUpperCase() : 'C',
      };
      setConversations((prev) => [newConv, ...prev]);
    }
  };

  return (
    <ChatContext.Provider
      value={{
        userProfile,
        updateUserProfile,
        conversations,
        messagesMap,
        addMessage,
        addConversation,
        updateLastMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);
