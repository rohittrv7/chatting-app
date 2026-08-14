import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, HardDrive, Wifi, Smartphone, Database } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'StorageSettings'>;

export const StorageSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();

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
        <Text style={[styles.title, { color: colors.textPrimary }]}>Storage & Data</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 }}>
        {[
          { label: 'Manage Storage', desc: '48.2 MB used • Clear media cache', icon: HardDrive, val: '48.2 MB' },
          { label: 'Network Usage', desc: 'Sent: 1.2 MB • Received: 4.8 MB', icon: Database, val: 'Stats' },
          { label: 'Media Auto-Download (Mobile)', desc: 'Photos only on cellular data', icon: Smartphone, val: 'Photos' },
          { label: 'Media Auto-Download (Wi-Fi)', desc: 'All media on Wi-Fi connection', icon: Wifi, val: 'All Media' },
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
              <Text style={[styles.cardVal, { color: colors.primaryIndigo }]}>{item.val}</Text>
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
  cardVal: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
});
