import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Image,
  Alert,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Camera, User, AtSign, Info, Phone, Check, QrCode } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export const EditProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, updateUserProfile } = useChat();
  const { themeMode, colors } = useTheme();

  const [name, setName] = useState(userProfile.name);
  const [username, setUsername] = useState(userProfile.username);
  const [status, setStatus] = useState(userProfile.status);
  const [phone, setPhone] = useState(userProfile.phone);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(userProfile.avatarUrl);
  const [isSaved, setIsSaved] = useState(false);

  const handlePickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Permission to access media library is required!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAvatarUri(result.assets[0].uri);
      }
    } catch (e) {
      console.warn('Error selecting profile picture:', e);
    }
  };

  const handleSave = () => {
    let cleanUsername = username.trim();
    if (!cleanUsername.startsWith('@')) {
      cleanUsername = `@${cleanUsername}`;
    }

    updateUserProfile({
      name: name.trim() || userProfile.name,
      username: cleanUsername,
      status: status.trim() || userProfile.status,
      phone: phone.trim() || userProfile.phone,
      avatarUrl: avatarUri,
    });

    setIsSaved(true);
    setTimeout(() => {
      navigation.goBack();
    }, 600);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header Bar */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Profile Information</Text>
        <TouchableOpacity style={styles.saveHeaderBtn} onPress={handleSave}>
          <Text style={[styles.saveHeaderText, { color: colors.primaryIndigo }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}>
        {/* Profile Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity activeOpacity={0.85} onPress={handlePickAvatar} style={styles.avatarWrapper}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.avatarInitial}>{name ? name[0].toUpperCase() : 'R'}</Text>
              </View>
            )}
            <View style={[styles.cameraBadgeCircle, { backgroundColor: colors.primaryIndigo, borderColor: colors.bg }]}>
              <Camera size={16} color="#FFF" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.changePhotoText, { color: colors.primaryIndigo }]}>Tap to change profile picture</Text>
        </View>

        {/* Input Card 1: Name */}
        <View style={[styles.inputGroupCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
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
        <View style={[styles.inputGroupCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
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
        <View style={[styles.inputGroupCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <View style={styles.inputHeaderRow}>
            <Info size={18} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>About / Status</Text>
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
        <View style={[styles.inputGroupCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
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
});
