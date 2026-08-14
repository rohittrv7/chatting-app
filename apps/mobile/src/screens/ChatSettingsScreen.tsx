import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, Image as ImageIcon, Database, SunMoon, HardDriveUpload, Check, Moon, Sun } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSettings'>;

export const ChatSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors, setThemeMode } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Chat & Appearance</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 }}>
        {/* Theme Selection Card Header */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>APP THEME MODE</Text>

        {/* Pure Deep Black Dark Mode Button */}
        <TouchableOpacity
          style={[
            styles.themeOptionCard,
            { backgroundColor: colors.surface, borderColor: themeMode === 'dark' ? colors.primaryIndigo : colors.cardBorder },
            themeMode === 'dark' && styles.selectedBorder,
          ]}
          activeOpacity={0.8}
          onPress={() => setThemeMode('dark')}
        >
          <View style={[styles.themeIconBox, { backgroundColor: '#181818' }]}>
            <Moon size={22} color="#6366F1" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              Pure Deep Black Dark Mode 🌙
            </Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Pitch black (#000000) backdrop, OLED battery saver
            </Text>
          </View>
          {themeMode === 'dark' && (
            <View style={[styles.checkCircle, { backgroundColor: colors.primaryIndigo }]}>
              <Check size={14} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        {/* Light Mode Button */}
        <TouchableOpacity
          style={[
            styles.themeOptionCard,
            { backgroundColor: colors.surface, borderColor: themeMode === 'light' ? colors.primaryIndigo : colors.cardBorder },
            themeMode === 'light' && styles.selectedBorder,
          ]}
          activeOpacity={0.8}
          onPress={() => setThemeMode('light')}
        >
          <View style={[styles.themeIconBox, { backgroundColor: '#F3E8FF' }]}>
            <Sun size={22} color="#6366F1" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              Light Mode ☀️
            </Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Soft lavender light background with high contrast
            </Text>
          </View>
          {themeMode === 'light' && (
            <View style={[styles.checkCircle, { backgroundColor: colors.primaryIndigo }]}>
              <Check size={14} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginTop: 24 }]}>OTHER SETTINGS</Text>

        {[
          { label: 'Chat Wallpaper', desc: 'Custom background tint & wall pattern', icon: ImageIcon },
          { label: 'Chat Backup', desc: 'Back up chats to cloud storage', icon: HardDriveUpload },
          { label: 'Media Auto-Download', desc: 'Wi-Fi & Cellular data settings', icon: Database },
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.cardBorder }]}>
                <Icon size={20} color={colors.primaryIndigo} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.label}</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{item.desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, marginRight: 10 },
  title: { fontSize: 20, fontWeight: '800' },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  themeOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
  },
  selectedBorder: {
    borderWidth: 2,
  },
  themeIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
});
