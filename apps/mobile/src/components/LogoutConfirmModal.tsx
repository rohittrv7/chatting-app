import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
} from 'react-native';
import { LogOut, AlertTriangle, X } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

interface LogoutConfirmModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  userName?: string;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  visible,
  onCancel,
  onConfirm,
  userName,
}) => {
  const { colors, themeMode } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[
            styles.modalCard,
            {
              backgroundColor: colors.surface,
              borderColor: themeMode === 'dark' ? '#334155' : '#E2E8F0',
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Top Close Button */}
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.cardBorder }]}
            onPress={onCancel}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Glowing Danger Icon */}
          <View style={styles.iconRing}>
            <View style={styles.iconInner}>
              <LogOut size={26} color="#EF4444" style={{ transform: [{ rotate: '180deg' }] }} />
            </View>
          </View>

          {/* Title & Description */}
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Log Out of Account?
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {userName ? `Hey ${userName}, are` : 'Are'} you sure you want to log out? You will need to verify your phone number with an OTP to sign back in.
          </Text>

          {/* Notice Pill */}
          <View
            style={[
              styles.noticePill,
              {
                backgroundColor: themeMode === 'dark' ? 'rgba(239, 68, 68, 0.1)' : '#FEF2F2',
                borderColor: themeMode === 'dark' ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2',
              },
            ]}
          >
            <AlertTriangle size={15} color="#EF4444" style={{ marginRight: 8 }} />
            <Text style={[styles.noticeText, { color: themeMode === 'dark' ? '#FCA5A5' : '#DC2626' }]}>
              Your chats and settings will be preserved.
            </Text>
          </View>

          {/* Buttons Row */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.cancelButton,
                {
                  backgroundColor: themeMode === 'dark' ? '#1E293B' : '#F1F5F9',
                  borderColor: colors.cardBorder,
                },
              ]}
              onPress={onCancel}
              activeOpacity={0.8}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <LogOut size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.confirmButtonText}>Yes, Log Out</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  noticePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
  },
  noticeText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  confirmButton: {
    flex: 1.2,
    backgroundColor: '#EF4444',
    paddingVertical: 13,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
