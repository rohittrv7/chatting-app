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
  ciphertexts?: any;
  content?: string;
  nonce?: string;
  isMe: boolean;
  time: string;
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED' | 'FAILED';
  createdAtMs?: number;
  createdAt?: string;
  isFile?: boolean;
  fileSize?: string;
  imagePath?: string;
  attachmentCrypto?: {
    fileKey: string;
    fileNonce: string;
  };
  location?: {
    lat: number;
    lng: number;
    label?: string;
    isLive?: boolean;
    liveDurationMinutes?: number;
    expiresAt?: string;
    isLiveEnded?: boolean;
    accuracy?: number;
  };
  document?: { uri: string; name: string; size?: number | string; mimeType?: string };
  contact?: { name: string; phone: string; username?: string };
  isStarred?: boolean;
  uploadProgress?: number;
  isUploading?: boolean;
  /** Reply-to: partial snapshot of the quoted message */
  replyTo?: { id: string; text: string; isMe: boolean; imagePath?: string };
  /** Emoji reactions: emoji string → count */
  reactions?: Record<string, number>;
  /** My own reaction on this message */
  myReaction?: string;
  /** In-chat Call history log item */
  callLog?: {
    callType: 'audio' | 'video';
    status: 'completed' | 'missed' | 'declined';
    durationSeconds?: number;
    isCaller: boolean;
  };
  /** Media metadata for receiver download cards */
  mediaSize?: string;
  isDownloaded?: boolean;
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
  Call: {
    callId: string;
    targetUserId: string;
    targetUserName?: string;
    isCaller: boolean;
    isVideo: boolean;
  };
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
