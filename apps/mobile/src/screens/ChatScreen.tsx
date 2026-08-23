import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Modal,
  Image,
  ScrollView,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ChatMessage } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { devInspector } from '../services/devInspectorService';
import {
  getResolvedDisplayName,
  getDeterministicConversationId,
} from '../services/contactsService';
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  Plus,
  Smile,
  Mic,
  Send,
  FileText,
  Check,
  CheckCheck,
  X,
  Star,
  Download,
  Share2,
  ZoomIn,
  ShieldCheck,
  User,
  Trash2,
  Bell,
  Eraser,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const EMOJI_LIST = [
  '😊',
  '😂',
  '🔥',
  '👍',
  '❤️',
  '🙏',
  '🎉',
  '🚀',
  '✨',
  '😍',
  '😎',
  '🙌',
  '💯',
  '👏',
  '🤔',
  '🥳',
  '🤝',
  '💪',
  '⭐',
  '💡',
  '👋',
  '🥰',
  '🤩',
  '😇',
  '🫡',
  '💖',
  '⚡',
  '🎯',
  '🌟',
  '🇮🇳',
];

export interface PendingMedia {
  uri: string;
  name: string;
}

export const ChatScreen: React.FC<Props> = ({ route, navigation }) => {
  const { conversationId, title } = route.params;
  const {
    conversations,
    messagesMap,
    addMessage,
    toggleStarMessage,
    deleteConversation,
    clearMessages,
    openChatRoom,
    closeChatRoom,
    isUserOnline,
    queryPresence,
    userProfile,
  } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();

  const currentConv = conversations.find(
    (c) => c.id === conversationId || c.title.toLowerCase() === title.toLowerCase(),
  );
  const resolvedDisplayName = getResolvedDisplayName(
    { username: currentConv?.username, name: currentConv?.title || title },
    title,
  );
  const resolvedUsername =
    currentConv?.username || `@${resolvedDisplayName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

  const isTargetOnline =
    isUserOnline(resolvedUsername) ||
    isUserOnline(currentConv?.username) ||
    isUserOnline(currentConv?.id) ||
    isUserOnline(resolvedDisplayName) ||
    isUserOnline(title);

  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingMediaList, setPendingMediaList] = useState<PendingMedia[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [selectedPhotoMsg, setSelectedPhotoMsg] = useState<ChatMessage | null>(null);
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [showMoreMenuModal, setShowMoreMenuModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    devInspector.logUi('ChatScreen', 'mount', `Chat with ${title} (${conversationId})`);
    openChatRoom(conversationId);
    queryPresence(
      [resolvedUsername, currentConv?.username || '', currentConv?.id || '', title].filter(Boolean),
    );
    return () => {
      devInspector.logUi('ChatScreen', 'unmount', `Chat with ${title}`);
      closeChatRoom(conversationId);
    };
  }, [conversationId, resolvedUsername]);

  const myIdentifier = userProfile.username || userProfile.phone || 'me';
  const targetIdentifier = resolvedUsername || title || conversationId;
  const canonicalConvId = getDeterministicConversationId(myIdentifier, targetIdentifier);

  const roomMessages = useMemo(() => {
    const rawList = messagesMap[conversationId] || [];
    const directList = messagesMap[canonicalConvId] || [];
    const handleClean = (resolvedUsername || '').replace(/^@+/, '').toLowerCase();
    const titleClean = (title || '').replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9]/g, '_');

    const altList = handleClean ? messagesMap[`conv_${handleClean}`] || [] : [];
    const titleList = titleClean ? messagesMap[`conv_${titleClean}`] || [] : [];
    const directMeList = handleClean ? messagesMap[`direct_me_${handleClean}`] || [] : [];

    const map = new Map<string, ChatMessage>();
    for (const msg of [...rawList, ...altList, ...titleList, ...directMeList, ...directList]) {
      if (msg && msg.id) {
        map.set(msg.id, msg);
      }
    }

    // Also check for any direct conversations between me and this contact in messagesMap
    if (handleClean) {
      for (const [key, msgs] of Object.entries(messagesMap)) {
        if (
          key.includes(handleClean) ||
          (titleClean && titleClean.length >= 3 && key.includes(titleClean))
        ) {
          if (Array.isArray(msgs)) {
            for (const msg of msgs) {
              if (msg && msg.id) map.set(msg.id, msg);
            }
          }
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const tA = a.createdAtMs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tB = b.createdAtMs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      if (tA && tB && tA !== tB) return tA - tB;
      return (a.time || '').localeCompare(b.time || '');
    });
  }, [messagesMap, conversationId, canonicalConvId, resolvedUsername, title]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
    );
    return () => showSub.remove();
  }, []);

  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, [roomMessages.length]);

  const handleSendMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    addMessage(
      canonicalConvId,
      text,
      true,
      undefined,
      resolvedUsername,
      resolvedDisplayName,
      resolvedUsername,
    );
    setInputText('');
    setShowEmojiPicker(false);
  };

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Permission to access photo library is required', 'warning');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const formatted: PendingMedia[] = result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName || `photo_${index + 1}.jpg`,
        }));
        setPendingMediaList(formatted);
        setMediaCaption('');
      }
    } catch (e) {
      console.warn('Error picking image:', e);
      showToast('Could not select image', 'error');
    }
  };

  const handleSendMediaPreview = () => {
    if (pendingMediaList.length === 0) return;

    pendingMediaList.forEach((media, idx) => {
      const captionToUse = idx === 0 ? mediaCaption.trim() : '';
      addMessage(
        canonicalConvId,
        captionToUse,
        true,
        media.uri,
        resolvedUsername,
        resolvedDisplayName,
        resolvedUsername,
      );
    });

    setPendingMediaList([]);
    setMediaCaption('');
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  const handleToggleStar = (msgId?: string) => {
    if (!msgId) return;
    const nowStarred = toggleStarMessage(conversationId, msgId);
    if (selectedPhotoMsg && selectedPhotoMsg.id === msgId) {
      setSelectedPhotoMsg((prev) => (prev ? { ...prev, isStarred: nowStarred } : null));
    }
    showToast(nowStarred ? 'Message Starred ⭐' : 'Message Unstarred', 'info');
  };

  const handleDownloadPhoto = async (photoUri?: string) => {
    if (!photoUri) return;
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = photoUri;
        link.download = `photo_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Photo download started!', 'success');
        return;
      }

      let localUri = photoUri;
      if (photoUri.startsWith('http://') || photoUri.startsWith('https://')) {
        const filename = photoUri.split('/').pop() || `photo_${Date.now()}.jpg`;
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        const downloadRes = await FileSystem.downloadAsync(photoUri, fileUri);
        localUri = downloadRes.uri;
      }

      try {
        const MediaLibraryModule = require('expo-media-library');
        if (MediaLibraryModule && MediaLibraryModule.requestPermissionsAsync) {
          const permission = await MediaLibraryModule.requestPermissionsAsync();
          if (permission.granted) {
            await MediaLibraryModule.saveToLibraryAsync(localUri);
            showToast('Photo saved to device gallery! 📸', 'success');
            return;
          }
        }
      } catch (modErr) {
        // Fallback to sharing if native media library is unavailable
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri);
        showToast('Photo ready to save / share', 'info');
      } else {
        showToast('Photo saved locally', 'success');
      }
    } catch (e: any) {
      console.warn('Error saving photo:', e);
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(photoUri);
        } else {
          showToast('Could not save photo to gallery', 'error');
        }
      } catch (err) {
        showToast('Could not save photo', 'error');
      }
    }
  };

  const handleSharePhoto = async (photoUri?: string) => {
    if (!photoUri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(photoUri);
      } else {
        showToast('Sharing is not available on this device', 'warning');
      }
    } catch (e) {
      showToast('Could not share photo', 'error');
    }
  };

  const renderBubble = (msg: ChatMessage) => {
    const isMe = msg.isMe;

    if (msg.isFile) {
      return (
        <View
          style={[styles.bubbleWrapper, isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperOther]}
        >
          <View
            style={[
              styles.bubble,
              isMe
                ? styles.bubbleMe
                : [
                    styles.bubbleOther,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ],
            ]}
          >
            <View style={styles.fileRow}>
              <View style={[styles.fileIconBox, { backgroundColor: colors.cardBorder }]}>
                <FileText size={20} color="#EA580C" />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.fileName, { color: isMe ? '#FFF' : colors.textPrimary }]}>
                  {msg.text || 'Document'}
                </Text>
                {msg.fileSize && (
                  <Text
                    style={[
                      styles.fileSize,
                      { color: isMe ? 'rgba(255, 255, 255, 0.75)' : colors.textSecondary },
                    ]}
                  >
                    {msg.fileSize}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.bubbleFooter}>
              {msg.isStarred && (
                <Star size={11} color="#FBBF24" fill="#FBBF24" style={{ marginRight: 4 }} />
              )}
              <Text
                style={[
                  styles.timeText,
                  { color: isMe ? 'rgba(255, 255, 255, 0.75)' : colors.textSecondary },
                ]}
              >
                {msg.time}
              </Text>
              {isMe && (
                <>
                  {msg.status === 'READ' ? (
                    <CheckCheck size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
                  ) : msg.status === 'DELIVERED' ? (
                    <CheckCheck
                      size={14}
                      color="rgba(255, 255, 255, 0.85)"
                      style={{ marginLeft: 4 }}
                    />
                  ) : (
                    <Check size={14} color="rgba(255, 255, 255, 0.6)" style={{ marginLeft: 4 }} />
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      );
    }

    return (
      <View
        style={[styles.bubbleWrapper, isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperOther]}
      >
        <View
          style={[
            styles.bubble,
            isMe
              ? styles.bubbleMe
              : [
                  styles.bubbleOther,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ],
          ]}
        >
          {msg.imagePath ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => setSelectedPhotoMsg(msg)}
              style={styles.imageBubbleWrapper}
            >
              <Image
                source={{ uri: msg.imagePath }}
                style={styles.chatImageBubble}
                resizeMode="cover"
              />
              <View style={styles.imageOverlayBadge}>
                <ZoomIn size={13} color="#FFF" />
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Only render text if user provided caption or message text */}
          {msg.text && msg.text.trim().length > 0 ? (
            <Text style={[styles.msgText, { color: isMe ? '#FFF' : colors.textPrimary }]}>
              {msg.text}
            </Text>
          ) : null}

          <View style={styles.bubbleFooter}>
            {msg.isStarred && (
              <Star size={11} color="#FBBF24" fill="#FBBF24" style={{ marginRight: 4 }} />
            )}
            <Text
              style={[
                styles.timeText,
                { color: isMe ? 'rgba(255, 255, 255, 0.75)' : colors.textSecondary },
              ]}
            >
              {msg.time}
            </Text>
            {isMe && (
              <>
                {msg.status === 'READ' ? (
                  // 🩵 Bright Electric Blue Double Tick (WhatsApp Read Receipt)
                  <CheckCheck size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
                ) : msg.status === 'DELIVERED' ? (
                  // 🤍 Double White Tick when delivered to recipient
                  <CheckCheck
                    size={14}
                    color="rgba(255, 255, 255, 0.85)"
                    style={{ marginLeft: 4 }}
                  />
                ) : (
                  // 🔘 Single Tick when sent to server
                  <Check size={14} color="rgba(255, 255, 255, 0.6)" style={{ marginLeft: 4 }} />
                )}
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
        ]}
      >
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ArrowLeft size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* 👤 Clickable Avatar & Name to Open Profile */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            onPress={() => setShowUserProfileModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatar, { backgroundColor: colors.cardBorder }]}>
                <Text style={[styles.avatarLetter, { color: colors.primaryIndigo }]}>
                  {resolvedDisplayName ? resolvedDisplayName[0].toUpperCase() : 'C'}
                </Text>
              </View>
              {isTargetOnline ? (
                <View
                  style={[
                    styles.onlineDot,
                    { backgroundColor: '#10B981', borderColor: colors.surface },
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.offlineBadgeSmall,
                    { backgroundColor: '#475569', borderColor: colors.surface },
                  ]}
                >
                  <Text style={{ color: '#FFF', fontSize: 7, fontWeight: '900', lineHeight: 8 }}>
                    ✕
                  </Text>
                </View>
              )}
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {resolvedDisplayName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={[styles.headerSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {resolvedUsername} •{' '}
                </Text>
                {isTargetOnline ? (
                  <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '600' }}>Online</Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={{
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: '800',
                        marginRight: 3,
                      }}
                    >
                      ✕
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Offline</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() =>
              navigation.navigate('Call', {
                callId: `call_${Date.now()}`,
                targetUserId: title,
                isCaller: true,
                isVideo: false,
              })
            }
          >
            <Phone size={20} color={colors.primaryIndigo} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() =>
              navigation.navigate('Call', {
                callId: `call_${Date.now()}`,
                targetUserId: title,
                isCaller: true,
                isVideo: true,
              })
            }
          >
            <Video size={22} color={colors.primaryIndigo} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setShowMoreMenuModal(true)}>
            <MoreVertical size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* "Today" Divider */}
      <View style={styles.dateDivider}>
        <Text style={[styles.dateText, { color: colors.textSecondary }]}>Today</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Message List */}
        <FlatList
          ref={flatListRef}
          data={roomMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderBubble(item)}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
        />

        {/* Emoji Picker Bar */}
        {showEmojiPicker && (
          <View
            style={[
              styles.emojiPickerContainer,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
            >
              {EMOJI_LIST.map((emoji, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.emojiItem}
                  onPress={() => handleEmojiSelect(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Bottom Input Bar */}
        <View
          style={[
            styles.inputBarContainer,
            { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
          ]}
        >
          <TouchableOpacity
            style={[styles.plusBtn, { backgroundColor: colors.cardBorder }]}
            onPress={handlePickImage}
          >
            <Plus size={20} color={colors.primaryIndigo} />
          </TouchableOpacity>

          <View
            style={[
              styles.inputFieldWrapper,
              { backgroundColor: colors.inputBg, borderColor: colors.cardBorder },
            ]}
          >
            <TextInput
              style={[styles.textInput, { color: colors.textPrimary }]}
              placeholder="Type a message..."
              placeholderTextColor={colors.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              returnKeyType="send"
              onSubmitEditing={handleSendMessage}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={{ padding: 4, marginRight: 6 }}
              onPress={() => setShowEmojiPicker(!showEmojiPicker)}
            >
              <Smile
                size={20}
                color={showEmojiPicker ? colors.primaryIndigo : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Send Button */}
          <TouchableOpacity style={styles.sendBtn} onPress={handleSendMessage}>
            <Send size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* 🖼️ Multi-Media Photo Sending Preview Modal */}
      <Modal visible={pendingMediaList.length > 0} animationType="slide" transparent={false}>
        <SafeAreaView style={[styles.previewModalContainer, { backgroundColor: colors.bg }]}>
          <View style={[styles.previewHeader, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              onPress={() => setPendingMediaList([])}
              style={styles.previewCloseBtn}
            >
              <X size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.previewTitle, { color: colors.textPrimary }]}>
              {pendingMediaList.length > 1
                ? `Send ${pendingMediaList.length} Photos`
                : 'Send Photo'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Multi-Image Scroll Preview */}
          <View style={styles.previewContent}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center' }}
            >
              {pendingMediaList.map((media, idx) => (
                <View
                  key={idx}
                  style={{
                    width: Dimensions.get('window').width - 32,
                    height: '100%',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Image
                    source={{ uri: media.uri }}
                    style={styles.fullscreenPreviewImage}
                    resizeMode="contain"
                  />
                </View>
              ))}
            </ScrollView>

            {pendingMediaList.length > 1 && (
              <View style={styles.multiBadge}>
                <Text style={styles.multiBadgeText}>{pendingMediaList.length} Selected</Text>
              </View>
            )}
          </View>

          {/* Preview Caption & Send Button */}
          <View
            style={[
              styles.previewFooterRow,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <View
              style={[
                styles.captionInputWrapper,
                { backgroundColor: colors.inputBg, borderColor: colors.cardBorder },
              ]}
            >
              <TextInput
                style={[styles.captionTextInput, { color: colors.textPrimary }]}
                placeholder="Add a caption..."
                placeholderTextColor={colors.textSecondary}
                value={mediaCaption}
                onChangeText={setMediaCaption}
                returnKeyType="send"
                onSubmitEditing={handleSendMediaPreview}
              />
            </View>
            <TouchableOpacity
              style={[styles.previewSendBtn, { backgroundColor: colors.primaryIndigo }]}
              onPress={handleSendMediaPreview}
            >
              <Send size={20} color="#FFF" style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 🖼️ Full Screen Photo Viewer Modal */}
      <Modal
        visible={!!selectedPhotoMsg}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedPhotoMsg(null)}
      >
        <SafeAreaView style={styles.photoViewerContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          {/* Top Bar with Back and Actions */}
          <View style={styles.photoViewerHeader}>
            <TouchableOpacity
              style={styles.viewerHeaderBtn}
              onPress={() => setSelectedPhotoMsg(null)}
            >
              <ArrowLeft size={22} color="#FFF" />
            </TouchableOpacity>

            <View style={styles.viewerHeaderCenter}>
              <Text style={styles.viewerSenderText} numberOfLines={1}>
                {selectedPhotoMsg?.isMe ? 'You' : title}
              </Text>
              <Text style={styles.viewerTimeText}>{selectedPhotoMsg?.time || 'Today'}</Text>
            </View>

            <View style={styles.viewerHeaderActions}>
              <TouchableOpacity
                style={styles.viewerActionBtn}
                onPress={() => handleDownloadPhoto(selectedPhotoMsg?.imagePath)}
                activeOpacity={0.7}
              >
                <Download size={22} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerActionBtn}
                onPress={() => handleSharePhoto(selectedPhotoMsg?.imagePath)}
                activeOpacity={0.7}
              >
                <Share2 size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Full Screen Image */}
          <View style={styles.photoViewerBody}>
            {selectedPhotoMsg?.imagePath && (
              <Image
                source={{ uri: selectedPhotoMsg.imagePath }}
                style={styles.photoViewerFullImage}
                resizeMode="contain"
              />
            )}
          </View>
          {selectedPhotoMsg?.text ? (
            <View style={styles.photoViewerFooter}>
              <Text style={styles.photoViewerCaption}>{selectedPhotoMsg.text}</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      {/* 👤 User Profile Info Modal (Opened on DP/Name click) */}
      <Modal
        visible={showUserProfileModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowUserProfileModal(false)}
      >
        <SafeAreaView style={[styles.profileModalContainer, { backgroundColor: colors.bg }]}>
          <StatusBar
            barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={colors.surface}
          />
          {/* Profile Header */}
          <View
            style={[
              styles.profileModalHeader,
              { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              onPress={() => setShowUserProfileModal(false)}
              style={styles.profileCloseBtn}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.7}
            >
              <ArrowLeft size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.profileModalTitle, { color: colors.textPrimary }]}>
              Contact Info
            </Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.profileModalContent}
          >
            {/* Big Avatar */}
            <View style={styles.profileHeroSection}>
              <View style={[styles.profileBigAvatar, { backgroundColor: colors.cardBorder }]}>
                <Text style={[styles.profileBigAvatarLetter, { color: colors.primaryIndigo }]}>
                  {resolvedDisplayName ? resolvedDisplayName[0].toUpperCase() : 'U'}
                </Text>
              </View>
              <Text style={[styles.profileHeroName, { color: colors.textPrimary }]}>
                {resolvedDisplayName}
              </Text>
              <Text style={[styles.profileHeroStatus, { color: colors.primaryIndigo }]}>
                {resolvedUsername}
              </Text>
            </View>

            {/* Quick Action Buttons */}
            <View style={styles.profileActionsRow}>
              <TouchableOpacity
                style={[
                  styles.profileActionBox,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setShowUserProfileModal(false);
                  navigation.navigate('Call', {
                    callId: `call_${Date.now()}`,
                    targetUserId: title,
                    isCaller: true,
                    isVideo: false,
                  });
                }}
              >
                <Phone size={22} color={colors.primaryIndigo} />
                <Text style={[styles.profileActionText, { color: colors.textPrimary }]}>Audio</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.profileActionBox,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setShowUserProfileModal(false);
                  navigation.navigate('Call', {
                    callId: `call_${Date.now()}`,
                    targetUserId: title,
                    isCaller: true,
                    isVideo: true,
                  });
                }}
              >
                <Video size={22} color={colors.primaryIndigo} />
                <Text style={[styles.profileActionText, { color: colors.textPrimary }]}>Video</Text>
              </TouchableOpacity>
            </View>

            {/* Info Card: About & Platform Handle */}
            <View
              style={[
                styles.profileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <Text style={[styles.profileCardHeader, { color: colors.primaryIndigo }]}>
                About & Username
              </Text>
              <Text style={[styles.profileAboutText, { color: colors.textPrimary }]}>
                Hey there! I am using WhatsApp Connect.
              </Text>
              <View style={[styles.profileDivider, { backgroundColor: colors.cardBorder }]} />
              <Text style={[styles.profilePhoneLabel, { color: colors.textSecondary }]}>
                Platform Handle
              </Text>
              <Text style={[styles.profilePhoneValue, { color: colors.primaryIndigo }]}>
                {resolvedUsername}
              </Text>
            </View>

            {/* Encryption & Security Card */}
            <View
              style={[
                styles.profileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ShieldCheck size={24} color="#10B981" />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.profileSecurityTitle, { color: colors.textPrimary }]}>
                    Encryption Verified
                  </Text>
                  <Text style={[styles.profileSecurityDesc, { color: colors.textSecondary }]}>
                    Messages and calls are end-to-end encrypted. No one outside of this chat can
                    read or listen to them.
                  </Text>
                </View>
              </View>
            </View>

            {/* Chat Management Options */}
            <View
              style={[
                styles.profileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder, marginTop: 14 },
              ]}
            >
              <TouchableOpacity
                style={styles.profileActionRowItem}
                onPress={() => {
                  setShowUserProfileModal(false);
                  setShowClearModal(true);
                }}
              >
                <Eraser size={20} color="#F59E0B" />
                <Text style={[styles.profileActionRowText, { color: colors.textPrimary }]}>
                  Clear Chat Messages
                </Text>
              </TouchableOpacity>

              <View style={[styles.profileActionDivider, { backgroundColor: colors.cardBorder }]} />

              <TouchableOpacity
                style={styles.profileActionRowItem}
                onPress={() => {
                  setShowUserProfileModal(false);
                  setShowDeleteModal(true);
                }}
              >
                <Trash2 size={20} color="#EF4444" />
                <Text
                  style={[styles.profileActionRowText, { color: '#EF4444', fontWeight: '700' }]}
                >
                  Delete Entire Chat
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 3-Dots Quick Popup Menu */}
      <Modal
        visible={showMoreMenuModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreMenuModal(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMoreMenuModal(false)}
        >
          <View
            style={[
              styles.menuDropdown,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowUserProfileModal(true);
              }}
            >
              <User size={18} color={colors.primaryIndigo} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Contact Info</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowClearModal(true);
              }}
            >
              <Eraser size={18} color="#F59E0B" />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Clear Chat</Text>
            </TouchableOpacity>

            <View style={[styles.menuDivider, { backgroundColor: colors.cardBorder }]} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowDeleteModal(true);
              }}
            >
              <Trash2 size={18} color="#EF4444" />
              <Text style={[styles.menuItemText, { color: '#EF4444', fontWeight: '700' }]}>
                Delete Chat
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Clear Chat Confirmation Modal */}
      <Modal
        visible={showClearModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearModal(false)}
      >
        <View style={styles.confirmOverlay}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View
              style={[styles.confirmIconCircle, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}
            >
              <Eraser size={28} color="#F59E0B" />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
              Clear chat messages?
            </Text>
            <Text style={[styles.confirmDesc, { color: colors.textSecondary }]}>
              All messages in this chat will be cleared from your device.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[
                  styles.confirmBtnCancel,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
                onPress={() => setShowClearModal(false)}
              >
                <Text style={[styles.confirmBtnCancelText, { color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtnAction, { backgroundColor: '#F59E0B' }]}
                onPress={() => {
                  clearMessages(canonicalConvId, [conversationId]);
                  setShowClearModal(false);
                  showToast('Chat cleared', 'info', 1500);
                }}
              >
                <Text style={styles.confirmBtnActionText}>Clear Messages</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Chat Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.confirmOverlay}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.confirmIconCircle}>
              <Trash2 size={28} color="#EF4444" />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
              Delete this chat?
            </Text>
            <Text style={[styles.confirmDesc, { color: colors.textSecondary }]}>
              This conversation and all its messages will be permanently deleted from your chat
              list.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[
                  styles.confirmBtnCancel,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
                onPress={() => setShowDeleteModal(false)}
              >
                <Text style={[styles.confirmBtnCancelText, { color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtnAction, { backgroundColor: '#EF4444' }]}
                onPress={() => {
                  deleteConversation(canonicalConvId, [conversationId]);
                  setShowDeleteModal(false);
                  showToast('Chat deleted', 'success', 1500);
                  navigation.goBack();
                }}
              >
                <Text style={styles.confirmBtnActionText}>Delete Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backBtn: {
    padding: 4,
    marginRight: 6,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
  },
  offlineBadgeSmall: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    padding: 6,
    marginLeft: 6,
  },
  dateDivider: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '500',
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bubbleWrapper: {
    marginBottom: 10,
    maxWidth: '80%',
  },
  bubbleWrapperMe: {
    alignSelf: 'flex-end',
  },
  bubbleWrapperOther: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMe: {
    backgroundColor: '#6366F1',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
  },
  imageBubbleWrapper: {
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
  },
  chatImageBubble: {
    width: 220,
    height: 160,
    borderRadius: 14,
  },
  imageOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeText: {
    fontSize: 11,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
  },
  fileSize: {
    fontSize: 12,
  },
  emojiPickerContainer: {
    borderTopWidth: 1,
    height: 52,
  },
  emojiItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiText: {
    fontSize: 24,
  },
  inputBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
  },
  plusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  inputFieldWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 2,
  },
  // Sending Preview Modal Styles
  previewModalContainer: {
    flex: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  previewCloseBtn: {
    padding: 4,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  previewContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  fullscreenPreviewImage: {
    width: '100%',
    height: '100%',
  },
  multiBadge: {
    position: 'absolute',
    top: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  multiBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  previewFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  captionInputWrapper: {
    flex: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    marginRight: 12,
  },
  captionTextInput: {
    fontSize: 15,
  },
  previewSendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 🔍 Full-Screen Photo Viewer Modal Styles
  photoViewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  photoViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 10,
  },
  viewerHeaderBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  viewerHeaderCenter: {
    flex: 1,
    marginLeft: 14,
  },
  viewerSenderText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  viewerTimeText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  viewerHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerActionBtn: {
    padding: 8,
    marginLeft: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  photoViewerBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoViewerFullImage: {
    width: '100%',
    height: '100%',
  },
  photoViewerFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  photoViewerCaption: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
  },
  // 👤 User Profile Info Modal Styles
  profileModalContainer: {
    flex: 1,
  },
  profileModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  profileCloseBtn: {
    padding: 6,
  },
  profileModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  profileModalContent: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
  },
  profileHeroSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  profileBigAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  profileBigAvatarLetter: {
    fontSize: 40,
    fontWeight: '800',
  },
  profileHeroName: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  profileHeroStatus: {
    fontSize: 14,
  },
  profileActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    marginBottom: 24,
  },
  profileActionBox: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  profileActionText: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  profileCard: {
    width: '100%',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
  },
  profileCardHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  profileAboutText: {
    fontSize: 15,
    lineHeight: 22,
  },
  profileDivider: {
    height: 1,
    marginVertical: 12,
  },
  profilePhoneLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  profilePhoneValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  profileSecurityTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileSecurityDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  profileActionRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  profileActionRowText: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 12,
  },
  profileActionDivider: {
    height: 1,
    width: '100%',
    marginVertical: 4,
  },
  // 3-Dots Menu Dropdown
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 50 : 60,
    paddingRight: 16,
  },
  menuDropdown: {
    width: 190,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
  menuDivider: {
    height: 1,
    marginVertical: 4,
  },
  // Confirmation Modals
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  confirmIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtnAction: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnActionText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
