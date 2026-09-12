import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Switch,
} from 'react-native';
import {
  X,
  Users,
  IndianRupee,
  Split,
  UserPlus,
  Trash2,
  Info,
  Check,
  Percent,
  Scale,
  Shield,
  Layers,
} from 'lucide-react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';

export interface SplitContact {
  id: string;
  name: string;
  phone?: string;
  username?: string;
}

export interface SplitBillColors {
  surface?: string;
  cardBorder?: string;
  primaryIndigo?: string;
  textPrimary?: string;
  textSecondary?: string;
  background?: string;
}

interface SplitBillModalProps {
  visible: boolean;
  onClose: () => void;
  conversationId?: string;
  defaultParticipants: SplitContact[];
  availableContacts?: SplitContact[];
  onSuccess: (expense: any) => void;
  colors?: SplitBillColors;
}

const CATEGORIES = [
  { id: 'FOOD', label: 'Food', icon: '🍔' },
  { id: 'TRAVEL', label: 'Travel', icon: '✈️' },
  { id: 'RENT', label: 'Rent', icon: '🏠' },
  { id: 'ENTERTAINMENT', label: 'Fun', icon: '🎬' },
  { id: 'SHOPPING', label: 'Shopping', icon: '🛍️' },
  { id: 'BILLS', label: 'Bills', icon: '💡' },
  { id: 'OTHER', label: 'Other', icon: '📦' },
];

type SplitMode = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';

const fallbackColors = {
  surface: '#111827',
  cardBorder: '#1F2937',
  primaryIndigo: '#6366F1',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  background: '#0B0F19',
};

export const SplitBillModal: React.FC<SplitBillModalProps> = ({
  visible,
  onClose,
  conversationId,
  defaultParticipants,
  availableContacts = [],
  onSuccess,
  colors,
}) => {
  const c = { ...fallbackColors, ...colors };
  const token = useSelector((state: RootState) => state.auth.token);
  const currentUserId = useSelector(
    (state: RootState) => (state.auth as any).userId || (state.auth as any).userProfile?.id || '',
  );
  const currentUserName = useSelector(
    (state: RootState) => (state.auth as any).userProfile?.name || 'You',
  );

  const [title, setTitle] = useState('');
  const [totalAmountStr, setTotalAmountStr] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('FOOD');
  const [splitMode, setSplitMode] = useState<SplitMode>('EQUAL');
  const [paidByUserId, setPaidByUserId] = useState<string>('me');
  const [isOngoingGroup, setIsOngoingGroup] = useState<boolean>(false);
  const [participants, setParticipants] = useState<SplitContact[]>([]);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Contact picker modal state
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');

  // Initialize participants
  useEffect(() => {
    if (visible) {
      setTitle('');
      setTotalAmountStr('');
      setSelectedCategory('FOOD');
      setSplitMode('EQUAL');
      setPaidByUserId('me');
      setIsOngoingGroup(false);
      setErrorMsg(null);
      setCustomShares({});
      setShowContactPicker(false);
      setContactSearchQuery('');

      const meContact: SplitContact = {
        id: currentUserId || 'me',
        name: `${currentUserName} (You)`,
      };

      const others = defaultParticipants.filter((p) => p.id !== currentUserId && p.id !== 'me');
      setParticipants([meContact, ...others]);
    }
  }, [visible, defaultParticipants, currentUserId, currentUserName]);

  const totalAmount = parseFloat(totalAmountStr) || 0;
  const participantCount = participants.length;
  const otherParticipantsCount = participants.filter(
    (p) => p.id !== currentUserId && p.id !== 'me',
  ).length;

  // Auto-calculated equal shares
  const equalSharePerPerson =
    participantCount > 0 && totalAmount > 0
      ? Math.round((totalAmount / participantCount) * 100) / 100
      : 0;

  // Calculate sum and validations for different split modes
  let allocatedSum = 0;
  let percentSum = 0;
  let totalSharesSum = 0;

  if (splitMode === 'EXACT') {
    participants.forEach((p) => {
      allocatedSum += parseFloat(customShares[p.id] || '0') || 0;
    });
  } else if (splitMode === 'PERCENT') {
    participants.forEach((p) => {
      percentSum += parseFloat(customShares[p.id] || '0') || 0;
    });
  } else if (splitMode === 'SHARES') {
    participants.forEach((p) => {
      totalSharesSum += parseFloat(customShares[p.id] || '1') || 1;
    });
  }

  const handleCustomShareChange = (userId: string, val: string) => {
    setCustomShares((prev) => ({ ...prev, [userId]: val }));
    if (errorMsg) setErrorMsg(null);
  };

  const handleAddParticipant = (contact: SplitContact) => {
    if (!participants.some((p) => p.id === contact.id)) {
      setParticipants((prev) => [...prev, contact]);
    }
    setShowContactPicker(false);
  };

  const handleRemoveParticipant = (contactId: string) => {
    if (contactId === currentUserId || contactId === 'me') return;
    setParticipants((prev) => prev.filter((p) => p.id !== contactId));
    if (paidByUserId === contactId) {
      setPaidByUserId('me');
    }
    setCustomShares((prev) => {
      const copy = { ...prev };
      delete copy[contactId];
      return copy;
    });
  };

  const getPayerDisplayName = () => {
    if (paidByUserId === 'me' || paidByUserId === currentUserId) return `${currentUserName} (You)`;
    const found = participants.find((p) => p.id === paidByUserId);
    return found?.name || 'Someone';
  };

  const handleCreateSplit = async () => {
    setErrorMsg(null);
    if (!title.trim()) {
      setErrorMsg('Please enter a description (e.g. Dinner, Rent, Cab)');
      return;
    }
    if (totalAmount <= 0) {
      setErrorMsg('Please enter a valid total amount');
      return;
    }
    if (participants.length < 2) {
      setErrorMsg('Need at least 2 people to split a bill');
      return;
    }

    let customAmountsPayload: Record<string, number> | undefined;
    let sharesPayload: Record<string, number> | undefined;

    if (splitMode === 'EXACT') {
      customAmountsPayload = {};
      let sum = 0;
      for (const p of participants) {
        const val = parseFloat(customShares[p.id] || '0') || 0;
        const actualId = p.id === 'me' ? currentUserId || '' : p.id;
        customAmountsPayload[actualId] = val;
        sum += val;
      }
      if (Math.abs(sum - totalAmount) > 0.05) {
        setErrorMsg(
          `Custom shares (₹${sum.toFixed(2)}) do not match total amount (₹${totalAmount.toFixed(2)})`,
        );
        return;
      }
    } else if (splitMode === 'PERCENT') {
      sharesPayload = {};
      let pSum = 0;
      for (const p of participants) {
        const val = parseFloat(customShares[p.id] || '0') || 0;
        const actualId = p.id === 'me' ? currentUserId || '' : p.id;
        sharesPayload[actualId] = val;
        pSum += val;
      }
      if (Math.abs(pSum - 100) > 0.5) {
        setErrorMsg(`Percentages must add up to 100% (currently ${pSum.toFixed(1)}%)`);
        return;
      }
    } else if (splitMode === 'SHARES') {
      sharesPayload = {};
      for (const p of participants) {
        const val = parseFloat(customShares[p.id] || '1') || 1;
        const actualId = p.id === 'me' ? currentUserId || '' : p.id;
        sharesPayload[actualId] = val;
      }
    }

    setIsSubmitting(true);
    try {
      if (!token) {
        setErrorMsg('Authentication error. Please log in again.');
        setIsSubmitting(false);
        return;
      }

      const cleanParticipantIds = participants.map((p) =>
        p.id === 'me' ? currentUserId || '' : p.id,
      );

      const resolvedPayerId = paidByUserId === 'me' ? currentUserId || '' : paidByUserId;

      const res = await apiService.createExpenseSplit(token, {
        title: title.trim(),
        totalAmount,
        currency: 'INR',
        conversationId,
        participantIds: cleanParticipantIds,
        paidByUserId: resolvedPayerId,
        splitType: splitMode,
        customAmounts: customAmountsPayload,
        shares: sharesPayload,
        category: selectedCategory,
        isOngoingGroup: otherParticipantsCount >= 2 ? isOngoingGroup : false,
        autoCreateGroup: otherParticipantsCount >= 2,
      });

      if (res.success && res.data) {
        onSuccess(res.data);
        onClose();
      } else {
        setErrorMsg(res.error || 'Failed to create bill split');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAvailable = availableContacts.filter((c) => {
    if (participants.some((p) => p.id === c.id)) return false;
    if (c.id === currentUserId) return false;
    if (!contactSearchQuery.trim()) return true;
    const q = contactSearchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.username && c.username.toLowerCase().includes(q))
    );
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.cardBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleGroup}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(99,102,241,0.15)' }]}>
                <Split size={20} color={c.primaryIndigo} />
              </View>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Split Expense</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.bodyScroll} keyboardShouldPersistTaps="handled">
            {/* Title Input */}
            <Text style={[styles.inputLabel, { color: c.textSecondary }]}>Description</Text>
            <TextInput
              style={[styles.textInput, { color: c.textPrimary, borderColor: c.cardBorder }]}
              placeholder="e.g. Dinner, Flat Rent, Uber, Groceries"
              placeholderTextColor={c.textSecondary}
              value={title}
              onChangeText={setTitle}
            />

            {/* Total Amount Input */}
            <Text style={[styles.inputLabel, { color: c.textSecondary }]}>Total Amount (₹)</Text>
            <View style={[styles.amountInputRow, { borderColor: c.cardBorder }]}>
              <Text style={[styles.rupeePrefix, { color: c.primaryIndigo }]}>₹</Text>
              <TextInput
                style={[styles.amountInput, { color: c.textPrimary }]}
                placeholder="0.00"
                placeholderTextColor={c.textSecondary}
                keyboardType="decimal-pad"
                value={totalAmountStr}
                onChangeText={setTotalAmountStr}
              />
            </View>

            {/* Category Selector */}
            <Text style={[styles.inputLabel, { color: c.textSecondary }]}>Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
            >
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => setSelectedCategory(cat.id)}
                    style={[
                      styles.categoryChip,
                      { borderColor: isSelected ? c.primaryIndigo : c.cardBorder },
                      isSelected && { backgroundColor: 'rgba(99, 102, 241, 0.18)' },
                    ]}
                  >
                    <Text style={styles.categoryIcon}>{cat.icon}</Text>
                    <Text
                      style={[
                        styles.categoryLabel,
                        {
                          color: isSelected ? '#FFF' : c.textSecondary,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* PAID BY Selector */}
            <View style={styles.sectionDivider} />
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>1. Paid by</Text>
              <Text style={[styles.sectionSub, { color: c.primaryIndigo }]}>
                Who paid the bill?
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.payerScroll}
            >
              {participants.map((p) => {
                const isPayer =
                  paidByUserId === p.id ||
                  (paidByUserId === 'me' && (p.id === currentUserId || p.id === 'me'));
                return (
                  <TouchableOpacity
                    key={`payer-${p.id}`}
                    onPress={() => setPaidByUserId(p.id)}
                    style={[
                      styles.payerChip,
                      { borderColor: isPayer ? c.primaryIndigo : c.cardBorder },
                      isPayer && { backgroundColor: c.primaryIndigo },
                    ]}
                  >
                    {isPayer && <Check size={14} color="#FFF" style={{ marginRight: 4 }} />}
                    <Text
                      style={[
                        styles.payerChipText,
                        {
                          color: isPayer ? '#FFF' : c.textSecondary,
                          fontWeight: isPayer ? '700' : '500',
                        },
                      ]}
                    >
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Split Mode Selector */}
            <View style={styles.sectionDivider} />
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>2. Split between</Text>
              <Text style={[styles.sectionSub, { color: c.textSecondary }]}>How to divide</Text>
            </View>

            <View
              style={[
                styles.toggleContainer,
                { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: c.cardBorder },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  splitMode === 'EQUAL' && { backgroundColor: c.primaryIndigo },
                ]}
                onPress={() => setSplitMode('EQUAL')}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    { color: splitMode === 'EQUAL' ? '#FFF' : c.textSecondary },
                  ]}
                >
                  = Equal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  splitMode === 'EXACT' && { backgroundColor: c.primaryIndigo },
                ]}
                onPress={() => setSplitMode('EXACT')}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    { color: splitMode === 'EXACT' ? '#FFF' : c.textSecondary },
                  ]}
                >
                  ₹ Exact
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  splitMode === 'PERCENT' && { backgroundColor: c.primaryIndigo },
                ]}
                onPress={() => setSplitMode('PERCENT')}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    { color: splitMode === 'PERCENT' ? '#FFF' : c.textSecondary },
                  ]}
                >
                  % Percent
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  splitMode === 'SHARES' && { backgroundColor: c.primaryIndigo },
                ]}
                onPress={() => setSplitMode('SHARES')}
              >
                <Text
                  style={[
                    styles.toggleBtnText,
                    { color: splitMode === 'SHARES' ? '#FFF' : c.textSecondary },
                  ]}
                >
                  ⚖️ Shares
                </Text>
              </TouchableOpacity>
            </View>

            {/* Notice Summary Banner */}
            <View
              style={[
                styles.summaryNotice,
                { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: c.cardBorder },
              ]}
            >
              <Text style={[styles.summaryNoticeText, { color: c.textPrimary }]}>
                Paid by{' '}
                <Text style={{ fontWeight: '700', color: c.primaryIndigo }}>
                  {getPayerDisplayName()}
                </Text>
                , split between <Text style={{ fontWeight: '700' }}>{participantCount} people</Text>
              </Text>
            </View>

            {/* Permanent vs Temporary Group Toggle (for 3+ people) */}
            {otherParticipantsCount >= 2 && (
              <View
                style={[
                  styles.ongoingGroupCard,
                  { backgroundColor: 'rgba(99,102,241,0.06)', borderColor: c.cardBorder },
                ]}
              >
                <View style={styles.ongoingLeft}>
                  <Layers size={18} color="#6366F1" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ongoingTitle, { color: c.textPrimary }]}>
                      Permanent Split Group
                    </Text>
                    <Text style={[styles.ongoingSub, { color: c.textSecondary }]}>
                      {isOngoingGroup
                        ? 'Ongoing group: keeps chat & records multiple expenses without auto-deleting.'
                        : 'Temporary split group: auto-deletes 24 hours after full settlement.'}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isOngoingGroup}
                  onValueChange={setIsOngoingGroup}
                  trackColor={{ false: '#374151', true: '#6366F1' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            )}

            {/* Participants Breakdown Header */}
            <View style={styles.participantsHeaderRow}>
              <Text style={[styles.inputLabel, { color: c.textSecondary, marginBottom: 0 }]}>
                Participants ({participants.length})
              </Text>
              <TouchableOpacity
                style={[styles.addPersonBtn, { borderColor: c.primaryIndigo }]}
                onPress={() => setShowContactPicker(true)}
              >
                <UserPlus size={13} color={c.primaryIndigo} />
                <Text style={[styles.addPersonBtnText, { color: c.primaryIndigo }]}>
                  Add Person
                </Text>
              </TouchableOpacity>
            </View>

            {/* Participants list */}
            {participants.map((p, idx) => {
              const isPayer =
                paidByUserId === p.id ||
                (paidByUserId === 'me' && (p.id === currentUserId || p.id === 'me'));
              const isMe = p.id === currentUserId || p.id === 'me';

              // Dynamic calculation based on split mode
              let shareSubtitle = '';
              if (splitMode === 'PERCENT' && totalAmount > 0) {
                const pVal = parseFloat(customShares[p.id] || '0') || 0;
                const calc = Math.round(totalAmount * (pVal / 100) * 100) / 100;
                shareSubtitle = `₹${calc.toFixed(2)}`;
              } else if (splitMode === 'SHARES' && totalAmount > 0 && totalSharesSum > 0) {
                const sVal = parseFloat(customShares[p.id] || '1') || 1;
                const calc = Math.round(totalAmount * (sVal / totalSharesSum) * 100) / 100;
                shareSubtitle = `₹${calc.toFixed(2)}`;
              }

              return (
                <View
                  key={p.id || idx}
                  style={[styles.participantRow, { borderColor: c.cardBorder }]}
                >
                  <View style={styles.participantInfo}>
                    <Text
                      style={[styles.participantName, { color: c.textPrimary }]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    <View style={styles.badgesRow}>
                      {isPayer ? <Text style={styles.payerBadge}>Payer</Text> : null}
                      {!isMe && (
                        <TouchableOpacity
                          onPress={() => handleRemoveParticipant(p.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2 size={13} color="#EF4444" style={{ marginLeft: 6 }} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Mode-specific input or label */}
                  {splitMode === 'EQUAL' && (
                    <Text style={[styles.equalAmountText, { color: c.primaryIndigo }]}>
                      ₹{equalSharePerPerson.toFixed(2)}
                    </Text>
                  )}

                  {splitMode === 'EXACT' && (
                    <View style={[styles.shareInputWrap, { borderColor: c.cardBorder }]}>
                      <Text style={{ color: c.textSecondary, fontSize: 13, marginRight: 2 }}>
                        ₹
                      </Text>
                      <TextInput
                        style={[styles.shareInput, { color: c.textPrimary }]}
                        placeholder="0"
                        placeholderTextColor={c.textSecondary}
                        keyboardType="decimal-pad"
                        value={customShares[p.id] || ''}
                        onChangeText={(val) => handleCustomShareChange(p.id, val)}
                      />
                    </View>
                  )}

                  {splitMode === 'PERCENT' && (
                    <View style={styles.percentCol}>
                      <View style={[styles.shareInputWrap, { borderColor: c.cardBorder }]}>
                        <TextInput
                          style={[styles.shareInput, { color: c.textPrimary }]}
                          placeholder="0"
                          placeholderTextColor={c.textSecondary}
                          keyboardType="decimal-pad"
                          value={customShares[p.id] || ''}
                          onChangeText={(val) => handleCustomShareChange(p.id, val)}
                        />
                        <Text style={{ color: c.textSecondary, fontSize: 13, marginLeft: 2 }}>
                          %
                        </Text>
                      </View>
                      {shareSubtitle ? (
                        <Text style={[styles.shareSubText, { color: c.primaryIndigo }]}>
                          {shareSubtitle}
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {splitMode === 'SHARES' && (
                    <View style={styles.percentCol}>
                      <View style={[styles.shareInputWrap, { borderColor: c.cardBorder }]}>
                        <TextInput
                          style={[styles.shareInput, { color: c.textPrimary }]}
                          placeholder="1"
                          placeholderTextColor={c.textSecondary}
                          keyboardType="number-pad"
                          value={customShares[p.id] || ''}
                          onChangeText={(val) => handleCustomShareChange(p.id, val)}
                        />
                        <Text style={{ color: c.textSecondary, fontSize: 12, marginLeft: 2 }}>
                          sh
                        </Text>
                      </View>
                      {shareSubtitle ? (
                        <Text style={[styles.shareSubText, { color: c.primaryIndigo }]}>
                          {shareSubtitle}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Split Mode Validation Indicator */}
            {splitMode === 'EXACT' && totalAmount > 0 && (
              <View style={styles.allocationStatus}>
                <Text
                  style={[
                    styles.allocationText,
                    { color: Math.abs(allocatedSum - totalAmount) < 0.05 ? '#10B981' : '#EF4444' },
                  ]}
                >
                  Allocated: ₹{allocatedSum.toFixed(2)} of ₹{totalAmount.toFixed(2)} (
                  {allocatedSum < totalAmount
                    ? `₹${(totalAmount - allocatedSum).toFixed(2)} remaining`
                    : allocatedSum > totalAmount
                      ? `₹${(allocatedSum - totalAmount).toFixed(2)} over`
                      : 'Exact match ✓'}
                  )
                </Text>
              </View>
            )}

            {splitMode === 'PERCENT' && (
              <View style={styles.allocationStatus}>
                <Text
                  style={[
                    styles.allocationText,
                    { color: Math.abs(percentSum - 100) < 0.5 ? '#10B981' : '#EF4444' },
                  ]}
                >
                  Total: {percentSum.toFixed(1)}% of 100% (
                  {percentSum < 100
                    ? `${(100 - percentSum).toFixed(1)}% remaining`
                    : percentSum > 100
                      ? `${(percentSum - 100).toFixed(1)}% over`
                      : '100% complete ✓'}
                  )
                </Text>
              </View>
            )}

            {/* Inline Contact Picker Modal */}
            {showContactPicker && (
              <View
                style={[
                  styles.contactPickerBox,
                  { backgroundColor: c.surface, borderColor: c.primaryIndigo },
                ]}
              >
                <View style={styles.contactPickerHeader}>
                  <Text style={[styles.contactPickerTitle, { color: c.textPrimary }]}>
                    Select Contact to Add
                  </Text>
                  <TouchableOpacity onPress={() => setShowContactPicker(false)}>
                    <X size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[
                    styles.contactSearchInput,
                    { color: c.textPrimary, borderColor: c.cardBorder },
                  ]}
                  placeholder="Search by name or number..."
                  placeholderTextColor={c.textSecondary}
                  value={contactSearchQuery}
                  onChangeText={setContactSearchQuery}
                />
                <ScrollView style={{ maxHeight: 150 }}>
                  {filteredAvailable.length === 0 ? (
                    <Text style={[styles.noContactsText, { color: c.textSecondary }]}>
                      No matching contacts found
                    </Text>
                  ) : (
                    filteredAvailable.map((contact) => (
                      <TouchableOpacity
                        key={contact.id}
                        style={[styles.contactItemRow, { borderBottomColor: c.cardBorder }]}
                        onPress={() => handleAddParticipant(contact)}
                      >
                        <Text style={[styles.contactItemName, { color: c.textPrimary }]}>
                          {contact.name}
                        </Text>
                        {contact.phone ? (
                          <Text style={[styles.contactItemPhone, { color: c.textSecondary }]}>
                            {contact.phone}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            )}

            {/* Error Message */}
            {errorMsg && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footerRow, { borderTopColor: c.cardBorder }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: 'rgba(255,255,255,0.06)' }]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={[styles.cancelBtnText, { color: c.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: c.primaryIndigo },
                isSubmitting && { opacity: 0.7 },
              ]}
              onPress={handleCreateSplit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>Create Split</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  bodyScroll: {
    paddingHorizontal: 20,
    maxHeight: 520,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 14,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 14,
  },
  rupeePrefix: {
    fontSize: 22,
    fontWeight: '700',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    paddingVertical: 8,
  },
  categoryScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    gap: 6,
  },
  categoryIcon: {
    fontSize: 14,
  },
  categoryLabel: {
    fontSize: 12,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSub: {
    fontSize: 11,
    fontWeight: '500',
  },
  payerScroll: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  payerChipText: {
    fontSize: 13,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    marginBottom: 12,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryNotice: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  summaryNoticeText: {
    fontSize: 12,
    textAlign: 'center',
  },
  ongoingGroupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  ongoingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  ongoingTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  ongoingSub: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 14,
  },
  participantsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  addPersonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  addPersonBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '500',
    maxWidth: 160,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  payerBadge: {
    fontSize: 10,
    color: '#6366F1',
    backgroundColor: 'rgba(99,102,241,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
    fontWeight: '700',
  },
  equalAmountText: {
    fontSize: 15,
    fontWeight: '700',
  },
  shareInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 80,
    justifyContent: 'flex-end',
  },
  shareInput: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
    padding: 0,
  },
  percentCol: {
    alignItems: 'flex-end',
  },
  shareSubText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  allocationStatus: {
    marginTop: 8,
    alignItems: 'center',
  },
  allocationText: {
    fontSize: 11,
    fontWeight: '600',
  },
  contactPickerBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  contactPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  contactPickerTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  contactSearchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    marginBottom: 8,
  },
  noContactsText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
  contactItemRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  contactItemName: {
    fontSize: 13,
    fontWeight: '600',
  },
  contactItemPhone: {
    fontSize: 11,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    borderRadius: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    paddingVertical: 13,
    alignItems: 'center',
    borderRadius: 12,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
