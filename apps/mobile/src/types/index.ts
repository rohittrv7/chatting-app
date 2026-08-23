export interface ConversationItem {
  id: string;
  title: string;
  username?: string;
  lastMessage: string;
  time: string;
  unread: string;
  avatar: string;
  isGroup?: boolean;
  groupBg?: string;
  isOnline?: boolean;
  isMuted?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  text: string;
  isMe: boolean;
  time: string;
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED';
  createdAtMs?: number;
  createdAt?: string;
  isFile?: boolean;
  fileSize?: string;
  imagePath?: string;
  isStarred?: boolean;
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
  Chat: { conversationId: string; title: string };
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
