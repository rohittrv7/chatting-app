import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Platform,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, PhoneCall, Volume2, Shield, Wifi } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'CallSettings'>;

export const CallSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Call Settings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 }}
      >
        {[
          { label: 'Ringtone & Vibration', desc: 'Default call ringtone', icon: Volume2 },
          {
            label: 'Silence Unknown Callers',
            desc: 'Auto silence numbers not in contacts',
            icon: PhoneCall,
          },
          { label: 'Low Data Usage for Calls', desc: 'Reduce network bandwidth', icon: Wifi },
          { label: 'WebRTC Encryption', desc: 'End-to-end P2P call security', icon: Shield },
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
  container: {
    flex: 1,
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
  cardDesc: { fontSize: 12, marginTop: 2 },
});
