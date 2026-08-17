import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ChatMessage } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const EMOJI_LIST = [
  '😊',
  '😂',
  '❤️',
  '🔥',
  '👍',
  '😍',
  '🎉',
  '💯',
  '🙏',
  '🥳',
  '😎',
  '🚀',
  '✨',
  '👏',
  '💡',
  '⚡',
  '🤩',
  '🌟',
  '💙',
  '🙌',
  '😜',
  '😭',
  '🤯',
  '💪',
  '💬',
  '🤙',
  '👀',
  '💯',
  '👌',
  '🤝',
  '🤝🏻',
  '⭐',
];

interface PendingMedia {
  uri: string;
  name: string;
}

export const ChatScreen: React.FC<Props> = ({ route, navigation }) => {
  const { conversationId, title } = route.params;
  const { messagesMap, addMessage, toggleStarMessage, openChatRoom, closeChatRoom } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();

  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingMediaList, setPendingMediaList] = useState<PendingMedia[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [selectedPhotoMsg, setSelectedPhotoMsg] = useState<ChatMessage | null>(null);

  useEffect(() => {
    openChatRoom(conversationId);
    return () => {
      closeChatRoom(conversationId);
    };
  }, [conversationId]);

  const roomMessages = messagesMap[conversationId] || [];

  const handleSendMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    addMessage(conversationId, text, true);
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
      addMessage(conversationId, captionToUse, true, media.uri);
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
                <CheckCheck size={14} color="rgba(255, 255, 255, 0.8)" style={{ marginLeft: 4 }} />
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
                  // 💜 Violet Double Tick when read by recipient
                  <CheckCheck size={14} color="#C4B5FD" style={{ marginLeft: 4 }} />
                ) : msg.status === 'DELIVERED' ? (
                  // 🤍 Double White Tick when delivered to recipient
                  <CheckCheck
                    size={14}
                    color="rgba(255, 255, 255, 0.9)"
                    style={{ marginLeft: 4 }}
                  />
                ) : (
                  // 🔘 Single Tick when sent to server
                  <Check size={14} color="rgba(255, 255, 255, 0.65)" style={{ marginLeft: 4 }} />
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
          <View style={styles.avatarWrapper}>
            <View style={[styles.avatar, { backgroundColor: colors.cardBorder }]}>
              <Text style={[styles.avatarLetter, { color: colors.primaryIndigo }]}>
                {title ? title[0].toUpperCase() : 'C'}
              </Text>
            </View>
            <View style={[styles.onlineDot, { borderColor: colors.surface }]} />
          </View>
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Online</Text>
          </View>
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
          <TouchableOpacity style={styles.actionBtn}>
            <MoreVertical size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* "Today" Divider */}
      <View style={styles.dateDivider}>
        <Text style={[styles.dateText, { color: colors.textSecondary }]}>Today</Text>
      </View>

      {/* Message List */}
      <FlatList
        data={roomMessages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderBubble(item)}
        contentContainerStyle={styles.messageList}
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
          <TouchableOpacity style={{ padding: 4 }}>
            <Mic size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Send Button */}
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: colors.primaryIndigo }]}
          onPress={handleSendMessage}
        >
          <Send size={18} color="#FFF" style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>

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

      {/* 🔍 Full-Screen High-Resolution Photo Viewer Modal with Star & Download */}
      <Modal
        visible={!!selectedPhotoMsg}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setSelectedPhotoMsg(null)}
      >
        <SafeAreaView style={styles.photoViewerContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />

          {/* Photo Viewer Top Header */}
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

            {/* Action icons: Star, Download, Share */}
            <View style={styles.viewerHeaderActions}>
              <TouchableOpacity
                style={styles.viewerActionBtn}
                onPress={() => handleToggleStar(selectedPhotoMsg?.id)}
                activeOpacity={0.7}
              >
                <Star
                  size={22}
                  color={selectedPhotoMsg?.isStarred ? '#FBBF24' : '#FFF'}
                  fill={selectedPhotoMsg?.isStarred ? '#FBBF24' : 'none'}
                />
              </TouchableOpacity>

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

          {/* Photo Viewer Center Body */}
          <View style={styles.photoViewerBody}>
            {selectedPhotoMsg?.imagePath && (
              <Image
                source={{ uri: selectedPhotoMsg.imagePath }}
                style={styles.photoViewerFullImage}
                resizeMode="contain"
              />
            )}
          </View>

          {/* Photo Caption Footer if exists */}
          {selectedPhotoMsg?.text ? (
            <View style={styles.photoViewerFooter}>
              <Text style={styles.photoViewerCaption}>{selectedPhotoMsg.text}</Text>
            </View>
          ) : null}
        </SafeAreaView>
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
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
});
