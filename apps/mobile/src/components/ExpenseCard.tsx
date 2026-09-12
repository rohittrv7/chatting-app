import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import {
  CheckCircle2,
  Clock,
  IndianRupee,
  Bell,
  Trash2,
  AlertCircle,
  Users,
} from 'lucide-react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

export interface ExpenseParticipantData {
  id: string;
  userId: string;
  amountOwed: number | string;
  shareValue?: number | string | null;
  isPaid: boolean;
  paidAt?: string | null;
  user?: {
    id: string;
    displayName?: string;
    phoneNumber?: string;
    avatarUrl?: string;
  };
}

export interface ExpenseSplitData {
  id: string;
  title: string;
  totalAmount: number | string;
  currency?: string;
  splitType?: 'EQUAL' | 'CUSTOM' | 'EXACT' | 'PERCENT' | 'SHARES';
  category?: string;
  isOngoingGroup?: boolean;
  paidBy?: string;
  status: 'ACTIVE' | 'SETTLED';
  createdBy: string;
  createdAt: string;
  settledAt?: string | null;
  autoDeleteAt?: string | null;
  splitGroupId?: string | null;
  conversationId?: string | null;
  participants: ExpenseParticipantData[];
  creator?: {
    id: string;
    displayName?: string;
    phoneNumber?: string;
    avatarUrl?: string;
  };
  payer?: {
    id: string;
    displayName?: string;
    phoneNumber?: string;
    avatarUrl?: string;
  };
}

interface ExpenseCardProps {
  expense: ExpenseSplitData;
  onUpdated?: (updatedExpense: ExpenseSplitData) => void;
  onDeleted?: (splitGroupId: string) => void;
  compact?: boolean;
}

export const ExpenseCard: React.FC<ExpenseCardProps> = ({
  expense,
  onUpdated,
  onDeleted,
  compact = false,
}) => {
  const { colors, themeMode } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);
  const currentUserId = useSelector(
    (state: RootState) => (state.auth as any).userId || (state.auth as any).userProfile?.id || '',
  );
  const { showToast } = useToast();

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [currentExpense, setCurrentExpense] = useState<ExpenseSplitData>(expense);

  useEffect(() => {
    setCurrentExpense(expense);
  }, [expense]);

  const isCreator = currentExpense.createdBy === currentUserId;
  const isSettled = currentExpense.status === 'SETTLED';
  const participants = currentExpense.participants || [];
  const totalAmount = Number(currentExpense.totalAmount) || 0;

  const paidCount = participants.filter((p) => p.isPaid).length;
  const totalCount = participants.length;
  const progressRatio = totalCount > 0 ? paidCount / totalCount : 0;

  // Calculate remaining time for auto-delete banner if settled
  const getRemainingTimeText = () => {
    if (!currentExpense.autoDeleteAt) return null;
    const diffMs = new Date(currentExpense.autoDeleteAt).getTime() - Date.now();
    if (diffMs <= 0) return 'Auto-deleting soon';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Group will be removed in ${hours}h ${mins}m`;
    return `Group will be removed in ${mins}m`;
  };

  const handleMarkPaid = async (targetUserId: string) => {
    setLoadingAction(`pay_${targetUserId}`);
    try {
      if (!token) {
        showToast('Please log in again', 'error');
        return;
      }

      const res = await apiService.markExpensePaid(token, currentExpense.id, targetUserId);
      if (res.success) {
        showToast('Marked as paid ✅', 'success');
        // Refresh details
        const refreshed = await apiService.getExpenseById(token, currentExpense.id);
        if (refreshed.success && refreshed.data) {
          setCurrentExpense(refreshed.data);
          onUpdated?.(refreshed.data);
        }
      } else {
        showToast(res.error || 'Failed to update status', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Error updating payment', 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSendReminder = async () => {
    setLoadingAction('remind');
    try {
      if (!token) return;

      const res = await apiService.remindExpenseUnpaid(token, currentExpense.id);
      if (res.success) {
        showToast('Payment reminder sent 🔔', 'success');
      } else {
        showToast(res.error || 'Failed to send reminder', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error', 'error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleForceDelete = async () => {
    Alert.alert(
      'Force Delete Split Group',
      'This will immediately remove this temporary group conversation. Expense history will stay in Hisaab. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: async () => {
            setLoadingAction('delete');
            try {
              if (!token) return;
              const res = await apiService.forceDeleteExpenseGroup(token, currentExpense.id);
              if (res.success) {
                showToast('Split group removed', 'info');
                if (currentExpense.splitGroupId) {
                  onDeleted?.(currentExpense.splitGroupId);
                }
              } else {
                showToast(res.error || 'Failed to delete group', 'error');
              }
            } catch (e: any) {
              showToast(e.message || 'Failed to delete', 'error');
            } finally {
              setLoadingAction(null);
            }
          },
        },
      ],
    );
  };

  const remainingTimeStr = getRemainingTimeText();

  const payerId = currentExpense.paidBy || currentExpense.createdBy;
  const isMePayer = payerId === currentUserId;
  const payerName = isMePayer
    ? 'You'
    : currentExpense.payer?.displayName ||
      currentExpense.payer?.phoneNumber ||
      currentExpense.creator?.displayName ||
      currentExpense.creator?.phoneNumber ||
      'Someone';

  const categoryIcons: Record<string, string> = {
    FOOD: '🍔',
    TRAVEL: '✈️',
    RENT: '🏠',
    ENTERTAINMENT: '🎬',
    SHOPPING: '🛍️',
    BILLS: '💡',
    OTHER: '📦',
  };
  const categoryIcon = categoryIcons[currentExpense.category || 'OTHER'] || '📦';

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: themeMode === 'dark' ? '#1E293B' : '#FFFFFF',
          borderColor: isSettled ? '#10B981' : colors.cardBorder,
        },
      ]}
    >
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleWithBadge}>
            <Text style={[styles.expenseTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {currentExpense.title}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: isSettled
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(245, 158, 11, 0.15)',
                },
              ]}
            >
              {isSettled ? (
                <CheckCircle2 size={12} color="#10B981" />
              ) : (
                <Clock size={12} color="#F59E0B" />
              )}
              <Text style={[styles.statusBadgeText, { color: isSettled ? '#10B981' : '#F59E0B' }]}>
                {isSettled ? 'SETTLED' : 'ACTIVE'}
              </Text>
            </View>
          </View>

          {/* Metadata tags: Category, Paid By, Split Mode */}
          <View style={styles.metaTagsRow}>
            <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
              <Text style={styles.tagPillText}>
                {categoryIcon} {currentExpense.category || 'OTHER'}
              </Text>
            </View>

            <View
              style={[
                styles.tagPill,
                { backgroundColor: isMePayer ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)' },
              ]}
            >
              <Text
                style={[
                  styles.tagPillText,
                  isMePayer && { color: colors.primaryIndigo, fontWeight: '700' },
                ]}
              >
                Paid by {payerName}
              </Text>
            </View>

            {currentExpense.splitType && currentExpense.splitType !== 'EQUAL' && (
              <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={styles.tagPillText}>{currentExpense.splitType}</Text>
              </View>
            )}

            {currentExpense.isOngoingGroup && (
              <View style={[styles.tagPill, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Text style={[styles.tagPillText, { color: '#10B981' }]}>Ongoing Group</Text>
              </View>
            )}
          </View>

          <Text style={[styles.totalAmountText, { color: colors.primaryIndigo }]}>
            ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </View>

      {/* Settled Countdown Notice */}
      {isSettled && currentExpense.splitGroupId && !currentExpense.isOngoingGroup && (
        <View style={styles.autoDeleteBanner}>
          <Clock size={14} color="#10B981" />
          <Text style={styles.autoDeleteBannerText}>
            🎉 All settled! {remainingTimeStr || 'Group will auto-delete in 24 hours.'}
          </Text>
        </View>
      )}
      {isSettled && currentExpense.isOngoingGroup && (
        <View
          style={[
            styles.autoDeleteBanner,
            { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.25)' },
          ]}
        >
          <CheckCircle2 size={14} color="#6366F1" />
          <Text style={[styles.autoDeleteBannerText, { color: colors.primaryIndigo }]}>
            🎉 All settled! Permanent group remains active.
          </Text>
        </View>
      )}

      {/* Progress Bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressHeaderRow}>
          <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
            Settlement Progress
          </Text>
          <Text
            style={[styles.progressCount, { color: isSettled ? '#10B981' : colors.textPrimary }]}
          >
            {paidCount} of {totalCount} paid
          </Text>
        </View>
        <View
          style={[
            styles.progressBarTrack,
            { backgroundColor: themeMode === 'dark' ? '#334155' : '#E2E8F0' },
          ]}
        >
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.round(progressRatio * 100)}%`,
                backgroundColor: isSettled ? '#10B981' : colors.primaryIndigo,
              },
            ]}
          />
        </View>
      </View>

      {/* ── WHO PAYS WHOM — Debt Summary ─────────────────────────────── */}
      {!compact &&
        !isSettled &&
        (() => {
          // Build a clear human-readable list: "Name → Payer: ₹X"
          const payerId = currentExpense.paidBy || currentExpense.createdBy;
          const unpaid = participants.filter((p) => !p.isPaid && p.userId !== payerId);
          if (unpaid.length === 0) return null;
          return (
            <View
              style={[
                styles.debtSummaryBox,
                {
                  borderColor: colors.cardBorder,
                  backgroundColor:
                    themeMode === 'dark' ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.06)',
                },
              ]}
            >
              <Text style={[styles.debtSummaryTitle, { color: colors.textSecondary }]}>
                💸 WHO PAYS WHOM
              </Text>
              {unpaid.map((p) => {
                const isMe = p.userId === currentUserId;
                const pName = isMe
                  ? 'You'
                  : p.user?.displayName || p.user?.phoneNumber || 'Participant';
                const owed = Number(p.amountOwed) || 0;
                return (
                  <View key={p.id || p.userId} style={styles.debtRow}>
                    <View style={styles.debtLeft}>
                      <View
                        style={[
                          styles.debtAvatar,
                          { backgroundColor: isMe ? '#E8622A' : colors.cardBorder },
                        ]}
                      >
                        <Text
                          style={[
                            styles.debtAvatarText,
                            { color: isMe ? '#FFF' : colors.textPrimary },
                          ]}
                        >
                          {pName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.debtPersonName,
                          {
                            color: isMe ? '#E8622A' : colors.textPrimary,
                            fontWeight: isMe ? '700' : '500',
                          },
                        ]}
                      >
                        {pName}
                      </Text>
                    </View>
                    <Text style={styles.debtArrow}>→</Text>
                    <View style={styles.debtRight}>
                      <Text style={[styles.debtPayerName, { color: colors.textSecondary }]}>
                        {payerName}
                      </Text>
                      <Text style={[styles.debtAmount, { color: '#E8622A' }]}>
                        ₹{owed.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })()}

      {/* Participants Breakdown */}
      {!compact && (
        <View style={styles.participantsList}>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            PARTICIPANTS & SHARES
          </Text>
          {participants.map((p) => {
            const isMe = p.userId === currentUserId;
            const pName = isMe
              ? 'You'
              : p.user?.displayName || p.user?.phoneNumber || 'Participant';
            const isCreatorRow = p.userId === currentExpense.createdBy;
            const owed = Number(p.amountOwed) || 0;
            const isRowLoading = loadingAction === `pay_${p.userId}`;

            return (
              <View
                key={p.id || p.userId}
                style={[
                  styles.participantRow,
                  { borderColor: colors.cardBorder },
                  isMe && {
                    backgroundColor:
                      themeMode === 'dark' ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)',
                  },
                ]}
              >
                <View style={styles.pLeftInfo}>
                  <View
                    style={[
                      styles.pAvatar,
                      { backgroundColor: isMe ? colors.primaryIndigo : colors.cardBorder },
                    ]}
                  >
                    <Text
                      style={[styles.pAvatarText, { color: isMe ? '#FFF' : colors.textPrimary }]}
                    >
                      {pName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text
                        style={[styles.pNameText, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {pName}
                      </Text>
                      {isCreatorRow && <Text style={styles.creatorTag}>Creator</Text>}
                    </View>
                    <Text style={[styles.pOwedText, { color: colors.textSecondary }]}>
                      Share: ₹{owed.toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Status or Mark Paid Action */}
                <View style={styles.pRightAction}>
                  {p.isPaid ? (
                    <View style={styles.paidBadge}>
                      <CheckCircle2 size={13} color="#10B981" />
                      <Text style={styles.paidBadgeText}>Paid</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Pending</Text>
                      </View>

                      {/* If it's me, or if I am creator, show Pay button */}
                      {(isMe || isCreator) && (
                        <TouchableOpacity
                          style={[
                            styles.payBtn,
                            { backgroundColor: isMe ? colors.primaryIndigo : '#10B981' },
                          ]}
                          onPress={() => handleMarkPaid(p.userId)}
                          disabled={isRowLoading}
                        >
                          {isRowLoading ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Text style={styles.payBtnText}>
                              {isMe ? 'Mark Paid' : 'Cash Received'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Creator Actions: Remind Unpaid & Force Delete */}
      <View style={styles.footerActions}>
        {isCreator && !isSettled && (
          <TouchableOpacity
            style={[styles.actionOutlineBtn, { borderColor: colors.primaryIndigo }]}
            onPress={handleSendReminder}
            disabled={loadingAction === 'remind'}
          >
            {loadingAction === 'remind' ? (
              <ActivityIndicator size="small" color={colors.primaryIndigo} />
            ) : (
              <>
                <Bell size={14} color={colors.primaryIndigo} />
                <Text style={[styles.actionOutlineBtnText, { color: colors.primaryIndigo }]}>
                  Remind Unpaid
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {isSettled && currentExpense.splitGroupId && (
          <TouchableOpacity
            style={[styles.actionOutlineBtn, { borderColor: '#EF4444' }]}
            onPress={handleForceDelete}
            disabled={loadingAction === 'delete'}
          >
            {loadingAction === 'delete' ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Trash2 size={14} color="#EF4444" />
                <Text style={[styles.actionOutlineBtnText, { color: '#EF4444' }]}>
                  Delete Group Now (Dev)
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  expenseTitle: {
    fontSize: 18,
    fontWeight: '700',
    maxWidth: '75%',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  metaTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  totalAmountText: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  autoDeleteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  autoDeleteBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    flex: 1,
  },
  progressSection: {
    marginTop: 14,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  participantsList: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  pLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pAvatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pNameText: {
    fontSize: 14,
    fontWeight: '600',
  },
  creatorTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#818CF8',
    backgroundColor: 'rgba(129, 140, 248, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  pOwedText: {
    fontSize: 12,
  },
  pRightAction: {
    alignItems: 'flex-end',
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  paidBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
  },
  pendingBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F59E0B',
  },
  payBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  payBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  actionOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionOutlineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  // ── Who Pays Whom ──────────────────────────────────────────────────────────
  debtSummaryBox: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  debtSummaryTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  debtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  debtLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  debtAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtAvatarText: {
    fontSize: 12,
    fontWeight: '700',
  },
  debtPersonName: {
    fontSize: 13,
    flex: 1,
  },
  debtArrow: {
    fontSize: 16,
    color: '#A0A0A8',
    paddingHorizontal: 4,
  },
  debtRight: {
    alignItems: 'flex-end',
    flex: 1,
  },
  debtPayerName: {
    fontSize: 11,
    marginBottom: 1,
  },
  debtAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
});
