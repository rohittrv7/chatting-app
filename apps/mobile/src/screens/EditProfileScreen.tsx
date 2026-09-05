import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Camera,
  User,
  AtSign,
  Info,
  Phone,
  Check,
  QrCode,
  Eye,
  Image as ImageIcon,
  X,
} from 'lucide-react-native';
import { Modal } from 'react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export const EditProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, updateUserProfile } = useChat();
  const { themeMode, colors } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);

  const [name, setName] = useState(userProfile.name);
  const [username, setUsername] = useState(userProfile.username);
  const [status, setStatus] = useState(userProfile.status);
  const [phone, setPhone] = useState(userProfile.phone);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(userProfile.avatarUrl);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showAvatarMenuModal, setShowAvatarMenuModal] = useState(false);
  const [showFullScreenAvatar, setShowFullScreenAvatar] = useState(false);
  const uploadedServerAvatarRef = useRef<string | undefined>(
    userProfile.avatarUrl && !userProfile.avatarUrl.startsWith('file://')
      ? userProfile.avatarUrl
      : undefined,
  );

  const _processPickedImage = async (result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      setAvatarUri(asset.uri);
      if (token) {
        setIsUploadingAvatar(true);
        try {
          // ⚡ FIX 5: Resize to 256x256 and compress to JPEG (<50KB) before uploading
          let manipulated: any = null;
          try {
            const ImageManipulator = require('expo-image-manipulator');
            manipulated = await ImageManipulator.manipulateAsync(
              asset.uri,
              [{ resize: { width: 256, height: 256 } }],
              { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
            );
          } catch {}

          const base64ToSend = manipulated?.base64 || asset.base64;
          if (base64ToSend) {
            const res = await apiService.uploadAvatar(token, base64ToSend);
            if (res.avatarUrl) {
              const fullUrl = apiService.getResolvedMediaUrl(res.avatarUrl) || res.avatarUrl;
              uploadedServerAvatarRef.current = fullUrl;
              setAvatarUri(fullUrl);
              updateUserProfile({ avatarUrl: fullUrl });
            }
          }
        } catch (e) {
          console.warn('Avatar upload error:', e);
        } finally {
          setIsUploadingAvatar(false);
        }
      }
    }
  };

  const handlePickFromGallery = async () => {
    setShowAvatarMenuModal(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Permission to access photo library is required!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
      });
      await _processPickedImage(result);
    } catch (e) {
      console.warn('Error selecting photo:', e);
    }
  };

  const handleTakePhoto = async () => {
    setShowAvatarMenuModal(false);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera permission is required to take a photo!');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
      });
      await _processPickedImage(result);
    } catch (e) {
      console.warn('Error taking photo:', e);
    }
  };

  const handleSave = () => {
    const cleanHandle = username.trim().replace(/^@+/, '');
    const cleanUsername = `@${cleanHandle}`;

    const finalAvatar =
      uploadedServerAvatarRef.current && !uploadedServerAvatarRef.current.startsWith('file://')
        ? uploadedServerAvatarRef.current
        : userProfile.avatarUrl && !userProfile.avatarUrl.startsWith('file://')
          ? userProfile.avatarUrl
          : undefined;

    const updatedProfile = {
      name: name.trim() || userProfile.name,
      username: cleanUsername,
      status: status.trim() || userProfile.status,
      phone: phone.trim() || userProfile.phone,
      avatarUrl: finalAvatar,
    };

    updateUserProfile(updatedProfile);

    if (token) {
      apiService
        .updateProfile(token, updatedProfile)
        .catch((e) => console.warn('Profile save API error:', e));
    }

    setIsSaved(true);
    setTimeout(() => {
      navigation.goBack();
    }, 600);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header Bar */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Profile Information</Text>
        <TouchableOpacity onPress={handleSave} style={styles.saveHeaderBtn}>
          <Text style={[styles.saveHeaderText, { color: colors.primaryIndigo }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowAvatarMenuModal(true)}
              style={styles.avatarWrapper}
            >
              {avatarUri ? (
                <Image
                  source={{ uri: apiService.getResolvedMediaUrl(avatarUri) }}
                  style={styles.avatarImage}
                />
              ) : (
                <View style={[styles.avatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                  <Text style={styles.avatarInitial}>{name ? name[0].toUpperCase() : 'R'}</Text>
                </View>
              )}
              <View
                style={[
                  styles.cameraBadgeCircle,
                  { backgroundColor: colors.primaryIndigo, borderColor: colors.bg },
                ]}
              >
                <Camera size={16} color="#FFF" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowAvatarMenuModal(true)} activeOpacity={0.7}>
              <Text style={[styles.changePhotoText, { color: colors.primaryIndigo }]}>
                Tap to change profile picture
              </Text>
            </TouchableOpacity>
          </View>

          {/* Input Card 1: Name */}
          <View
            style={[
              styles.inputGroupCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.inputHeaderRow}>
              <User size={18} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Name</Text>
            </View>
            <TextInput
              style={[styles.textInputField, { color: colors.textPrimary }]}
              value={name}
              onChangeText={setName}
              placeholder="Enter your full name"
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={[styles.inputInfoNote, { color: colors.textSecondary }]}>
              This is not your username or PIN. This name will be visible to your contacts.
            </Text>
          </View>

          {/* Input Card 2: Username */}
          <View
            style={[
              styles.inputGroupCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.inputHeaderRow}>
              <AtSign size={18} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Username</Text>
            </View>
            <TextInput
              style={[styles.textInputField, { color: colors.primaryIndigo }]}
              value={username}
              onChangeText={setUsername}
              placeholder="@username"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            <Text style={[styles.inputInfoNote, { color: colors.textSecondary }]}>
              People can find and message you on chatting system using this unique handle.
            </Text>
          </View>

          {/* Input Card 3: About / Bio */}
          <View
            style={[
              styles.inputGroupCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.inputHeaderRow}>
              <Info size={18} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                About / Status
              </Text>
            </View>
            <TextInput
              style={[styles.textInputField, { color: colors.textPrimary }]}
              value={status}
              onChangeText={setStatus}
              placeholder="Available | Can't talk, chatting system only"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </View>

          {/* Input Card 4: Phone Number */}
          <View
            style={[
              styles.inputGroupCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.inputHeaderRow}>
              <Phone size={18} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Phone Number</Text>
            </View>
            <TextInput
              style={[styles.textInputField, { color: colors.textPrimary }]}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+91 98765 43210"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveBtn,
              { backgroundColor: isSaved ? colors.onlineEmerald : colors.primaryIndigo },
            ]}
            activeOpacity={0.85}
            onPress={handleSave}
          >
            {isSaved ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Check size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.saveBtnText}>Profile Saved!</Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>Save Profile</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 📸 Avatar Options Bottom Sheet Modal */}
      <Modal
        visible={showAvatarMenuModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAvatarMenuModal(false)}
      >
        <TouchableOpacity
          style={styles.menuModalBackdrop}
          activeOpacity={1}
          onPress={() => setShowAvatarMenuModal(false)}
        >
          <View
            style={[
              styles.menuModalCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.menuModalTitle, { color: colors.textPrimary }]}>
              Profile Photo
            </Text>

            {avatarUri ? (
              <TouchableOpacity
                style={styles.menuModalRow}
                onPress={() => {
                  setShowAvatarMenuModal(false);
                  setShowFullScreenAvatar(true);
                }}
              >
                <Eye size={22} color={colors.primaryIndigo} />
                <Text style={[styles.menuModalRowText, { color: colors.textPrimary }]}>
                  View Profile Photo
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.menuModalRow} onPress={handleTakePhoto}>
              <Camera size={22} color="#10B981" />
              <Text style={[styles.menuModalRowText, { color: colors.textPrimary }]}>
                Take Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuModalRow} onPress={handlePickFromGallery}>
              <ImageIcon size={22} color="#8B5CF6" />
              <Text style={[styles.menuModalRowText, { color: colors.textPrimary }]}>
                Choose from Gallery
              </Text>
            </TouchableOpacity>

            <View style={[styles.menuModalDivider, { backgroundColor: colors.cardBorder }]} />

            <TouchableOpacity
              style={styles.menuModalCancelBtn}
              onPress={() => setShowAvatarMenuModal(false)}
            >
              <Text style={[styles.menuModalCancelText, { color: colors.textSecondary }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 🖼️ Fullscreen Profile Photo Viewer */}
      <Modal
        visible={showFullScreenAvatar}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setShowFullScreenAvatar(false)}
      >
        <SafeAreaView style={styles.fullScreenPhotoContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          <View style={styles.fullScreenPhotoHeader}>
            <TouchableOpacity
              onPress={() => setShowFullScreenAvatar(false)}
              style={styles.fullScreenPhotoBackBtn}
            >
              <ArrowLeft size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.fullScreenPhotoTitle}>Profile Photo</Text>
            <TouchableOpacity
              onPress={() => {
                setShowFullScreenAvatar(false);
                setShowAvatarMenuModal(true);
              }}
              style={styles.fullScreenPhotoBackBtn}
            >
              <Camera size={22} color="#FFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.fullScreenPhotoBody}>
            {avatarUri ? (
              <Image
                source={{ uri: apiService.getResolvedMediaUrl(avatarUri) }}
                style={styles.fullScreenPhotoImage}
                resizeMode="contain"
              />
            ) : (
              <View
                style={[
                  styles.avatarCircle,
                  {
                    width: 220,
                    height: 220,
                    borderRadius: 110,
                    backgroundColor: colors.primaryIndigo,
                  },
                ]}
              >
                <Text style={[styles.avatarInitial, { fontSize: 72 }]}>
                  {name ? name[0].toUpperCase() : 'R'}
                </Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
  },
  saveHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  saveHeaderText: {
    fontSize: 16,
    fontWeight: '800',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFF',
  },
  cameraBadgeCircle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
  },
  inputGroupCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  inputHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  textInputField: {
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 4,
  },
  inputInfoNote: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
  },
  saveBtn: {
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  menuModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  menuModalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
  },
  menuModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  menuModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  menuModalRowText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 14,
  },
  menuModalDivider: {
    height: 1,
    marginVertical: 10,
  },
  menuModalCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  menuModalCancelText: {
    fontSize: 16,
    fontWeight: '700',
  },
  fullScreenPhotoContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullScreenPhotoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111',
  },
  fullScreenPhotoBackBtn: {
    padding: 6,
  },
  fullScreenPhotoTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  fullScreenPhotoBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  fullScreenPhotoImage: {
    width: '100%',
    height: '100%',
  },
});
