import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { X, CheckCircle2, ArrowRight, IndianRupee, ShieldCheck } from 'lucide-react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { useToast } from '../context/ToastContext';

export interface SettleUpContact {
  id: string;
  name: string;
  phone?: string;
  suggestedAmount?: number;
  status?: 'OWES_YOU' | 'YOU_OWE' | 'SETTLED';
}

interface SettleUpModalProps {
  visible: boolean;
  onClose: () => void;
  contact: SettleUpContact | null;
  onSuccess: () => void;
  colors?: {
    surface?: string;
    cardBorder?: string;
    primaryIndigo?: string;
    textPrimary?: string;
    textSecondary?: string;
    background?: string;
  };
}

const fallbackColors = {
  surface: '#111827',
  cardBorder: '#1F2937',
  primaryIndigo: '#6366F1',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  background: '#0B0F19',
};

export const SettleUpModal: React.FC<SettleUpModalProps> = ({
  visible,
  onClose,
  contact,
  onSuccess,
  colors,
}) => {
  const c = { ...fallbackColors, ...colors };
  const token = useSelector((state: RootState) => state.auth.token);
  const currentUserName = useSelector(
    (state: RootState) => (state.auth as any).userProfile?.name || 'You',
  );
  const { showToast } = useToast();

  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible && contact) {
      setAmountStr(contact.suggestedAmount ? String(contact.suggestedAmount) : '');
      setNotes('Direct Settlement');
      setErrorMsg(null);
    }
  }, [visible, contact]);

  if (!contact) return null;

  const amount = parseFloat(amountStr) || 0;
  const isYouPaying = contact.status === 'YOU_OWE';

  const handleSettle = async () => {
    setErrorMsg(null);
    if (amount <= 0) {
      setErrorMsg('Please enter a valid payment amount');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!token) {
        setErrorMsg('Authentication error. Please log in again.');
        setIsSubmitting(false);
        return;
      }

      const res = await apiService.settleUp(token, {
        targetUserId: contact.id,
        amount,
        notes: notes.trim() || undefined,
        currency: 'INR',
      });

      if (res.success) {
        showToast('Settlement recorded successfully! 🎉', 'success');
        onSuccess();
        onClose();
      } else {
        setErrorMsg(res.error || 'Failed to record settlement');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.cardBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                <CheckCircle2 size={20} color="#6366F1" />
              </View>
              <Text style={[styles.title, { color: c.textPrimary }]}>Settle Up</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: 'rgba(255,255,255,0.06)' }]}
            >
              <X size={18} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Transfer direction banner */}
          <View
            style={[
              styles.transferBanner,
              { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: c.cardBorder },
            ]}
          >
            <Text style={[styles.transferParty, { color: c.textPrimary }]} numberOfLines={1}>
              {isYouPaying ? currentUserName : contact.name}
            </Text>
            <View style={styles.transferArrow}>
              <ArrowRight size={16} color="#6366F1" />
              <Text style={styles.paysText}>pays</Text>
            </View>
            <Text style={[styles.transferParty, { color: c.textPrimary }]} numberOfLines={1}>
              {isYouPaying ? contact.name : currentUserName}
            </Text>
          </View>

          {/* Amount input */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Settlement Amount</Text>
            <View
              style={[
                styles.amountInputWrap,
                { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: c.cardBorder },
              ]}
            >
              <Text style={styles.currencySymbol}>₹</Text>
              <TextInput
                style={[styles.amountInput, { color: c.textPrimary }]}
                placeholder="0.00"
                placeholderTextColor={c.textSecondary}
                keyboardType="decimal-pad"
                value={amountStr}
                onChangeText={(val) => {
                  setAmountStr(val);
                  if (errorMsg) setErrorMsg(null);
                }}
              />
            </View>
            {contact.suggestedAmount ? (
              <TouchableOpacity
                onPress={() => setAmountStr(String(contact.suggestedAmount))}
                style={styles.fullAmountBtn}
              >
                <Text style={styles.fullAmountText}>
                  Pay full balance: ₹{contact.suggestedAmount}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Notes input */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Payment Note (Optional)</Text>
            <TextInput
              style={[
                styles.notesInput,
                {
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  borderColor: c.cardBorder,
                  color: c.textPrimary,
                },
              ]}
              placeholder="e.g. GPay, Cash, UPI transfer"
              placeholderTextColor={c.textSecondary}
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {/* Security & Audit notice */}
          <View style={styles.auditNotice}>
            <ShieldCheck size={14} color="#10B981" />
            <Text style={[styles.auditText, { color: c.textSecondary }]}>
              Direct settlements immediately deduct from shared balances and update debt history.
            </Text>
          </View>

          {/* Error display */}
          {errorMsg ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: c.cardBorder }]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={[styles.cancelBtnText, { color: c.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, { opacity: isSubmitting || amount <= 0 ? 0.6 : 1 }]}
              onPress={handleSettle}
              disabled={isSubmitting || amount <= 0}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Record Settlement</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
  },
  transferParty: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '38%',
  },
  transferArrow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  paysText: {
    fontSize: 10,
    color: '#6366F1',
    fontWeight: '600',
    marginTop: 2,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  amountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 52,
  },
  currencySymbol: {
    fontSize: 22,
    fontWeight: '700',
    color: '#6366F1',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    padding: 0,
  },
  fullAmountBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  fullAmountText: {
    fontSize: 12,
    color: '#6366F1',
    fontWeight: '600',
  },
  notesInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  auditNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  auditText: {
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
