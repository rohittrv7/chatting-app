export interface ConversationItem {
  id: string;
  title: string;
  username?: string;
  phone?: string;
  avatarUrl?: string;
  about?: string;
  /** DB UUID of the other participant — used as receiverId in socket sends */
  recipientDbId?: string;
  lastMessage: string;
  time: string;
  unread: string;
  avatar: string;
  isGroup?: boolean;
  groupBg?: string;
  isOnline?: boolean;
  isMuted?: boolean;
  lastMessageStatus?: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED' | 'FAILED';
  lastMessageIsMe?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  text: string;
  isMe: boolean;
  time: string;
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED' | 'FAILED';
  createdAtMs?: number;
  createdAt?: string;
  isFile?: boolean;
  fileSize?: string;
  imagePath?: string;
  location?: { lat: number; lng: number; label?: string };
  isStarred?: boolean;
  uploadProgress?: number;
  isUploading?: boolean;
  /** Reply-to: partial snapshot of the quoted message */
  replyTo?: { id: string; text: string; isMe: boolean; imagePath?: string };
  /** Emoji reactions: emoji string → count */
  reactions?: Record<string, number>;
  /** My own reaction on this message */
  myReaction?: string;
}

export interface UserProfile {
  name: string;
  username: string;
  status: string;
  phone: string;
  avatarUrl?: string;
}

export type RootStackParamList = {
  PhoneAuth: undefined;
  OtpVerification: { phoneNumber: string; generatedOtp?: string };
  NewUserProfileSetup: { phoneNumber: string };
  MainTabs: undefined;
  Chat: {
    conversationId: string;
    title: string;
    username?: string;
    avatarUrl?: string;
    phone?: string;
    recipientDbId?: string;
  };
  Call: { callId: string; targetUserId: string; isCaller: boolean; isVideo: boolean };
  Contacts: undefined;
  EditProfile: undefined;
  AccountSettings: undefined;
  PrivacySettings: undefined;
  ChatSettings: undefined;
  CallSettings: undefined;
  NotificationSettings: undefined;
  StorageSettings: undefined;
  HelpSettings: undefined;
  QrCode: undefined;
};
