import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, Lock, Eye, Clock, CheckCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'PrivacySettings'>;

export const PrivacySettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Privacy Settings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 }}
      >
        {[
          { label: 'Last Seen & Online', val: 'Everyone', icon: Clock },
          { label: 'Profile Photo', val: 'My Contacts', icon: Eye },
          { label: 'About', val: 'Everyone', icon: Lock },
          { label: 'Read Receipts', val: 'Enabled', icon: CheckCheck },
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.cardBorder }]}>
                <Icon size={20} color={colors.primaryIndigo} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.label}</Text>
                <Text style={[styles.cardDesc, { color: colors.primaryIndigo }]}>{item.val}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 4 : 0,
  },
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
  cardDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
