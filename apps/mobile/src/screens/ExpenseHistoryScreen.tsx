import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
} from 'react-native';
import {
  ArrowLeft,
  Receipt,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  Clock,
  ChevronRight,
  Filter,
  X,
  IndianRupee,
  Plus,
  Scale,
  HandCoins,
  ShieldCheck,
  User,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { ExpenseCard, ExpenseSplitData } from '../components/ExpenseCard';
import { SplitBillModal } from '../components/SplitBillModal';
import { SettleUpModal, SettleUpContact } from '../components/SettleUpModal';

const CATEGORIES = [
  { id: 'ALL', label: 'All', icon: '✨' },
  { id: 'FOOD', label: 'Food', icon: '🍔' },
  { id: 'TRAVEL', label: 'Travel', icon: '✈️' },
  { id: 'RENT', label: 'Rent', icon: '🏠' },
  { id: 'ENTERTAINMENT', label: 'Fun', icon: '🎬' },
  { id: 'SHOPPING', label: 'Shopping', icon: '🛍️' },
  { id: 'BILLS', label: 'Bills', icon: '💡' },
  { id: 'OTHER', label: 'Other', icon: '📦' },
];

export const ExpenseHistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors, themeMode } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);
  const currentUserId = useSelector(
    (state: RootState) => (state.auth as any).userId || (state.auth as any).userProfile?.id || '',
  );

  // Main Tab: Net Balances vs All Expenses History
  const [activeMainTab, setActiveMainTab] = useState<'BALANCES' | 'HISTORY'>('BALANCES');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // History state
  const [splits, setSplits] = useState<ExpenseSplitData[]>([]);
  const [summary, setSummary] = useState({
    totalOwedByMe: 0,
    totalOwedToMe: 0,
    activeCount: 0,
    settledCount: 0,
    totalCount: 0,
  });
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SETTLED'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Net Balances state
  const [netBalances, setNetBalances] = useState<any[]>([]);
  const [netSummary, setNetSummary] = useState({
    totalYouAreOwed: 0,
    totalYouOwe: 0,
    netTotal: 0,
  });
  const [recentSettlements, setRecentSettlements] = useState<any[]>([]);

  // Modals state
  const [selectedExpense, setSelectedExpense] = useState<ExpenseSplitData | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [settleContact, setSettleContact] = useState<SettleUpContact | null>(null);

  const fetchData = useCallback(async () => {
    try {
      if (!token) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 1. Fetch Net Balances
      const netRes = await apiService.getNetBalances(token);
      if (netRes.success && netRes.data) {
        setNetBalances(netRes.data.balances || []);
        if (netRes.data.summary) {
          setNetSummary(netRes.data.summary);
        }
        setRecentSettlements(netRes.data.recentSettlements || []);
      }

      // 2. Fetch Expense History with category filter
      const histRes = await apiService.getExpenseHistory(token, {
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
      });
      if (histRes.success && histRes.data) {
        const data = histRes.data as any;
        setSplits(data.splits || []);
        if (data.summary) {
          setSummary(data.summary);
        }
      }
    } catch (e) {
      console.warn('Failed to load hisaab data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, categoryFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const filteredSplits = splits.filter((s) => {
    if (statusFilter === 'ACTIVE') return s.status === 'ACTIVE';
    if (statusFilter === 'SETTLED') return s.status === 'SETTLED';
    return true;
  });

  const renderSplitItem = ({ item }: { item: ExpenseSplitData }) => {
    const isSettled = item.status === 'SETTLED';
    const payerId = item.paidBy || item.createdBy;
    const isMePayer = payerId === currentUserId;
    const myShare = item.participants?.find((p) => p.userId === currentUserId);
    const dateStr = new Date(item.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });

    let myRoleText = '';
    let myRoleColor = colors.textSecondary;

    if (isMePayer) {
      const unpaidCount = item.participants.filter(
        (p) => !p.isPaid && p.userId !== currentUserId,
      ).length;
      myRoleText = unpaidCount > 0 ? `${unpaidCount} pending from others` : 'All cleared';
      myRoleColor = unpaidCount > 0 ? '#10B981' : colors.textSecondary;
    } else if (myShare) {
      if (myShare.isPaid) {
        myRoleText = 'You paid your share';
        myRoleColor = '#10B981';
      } else {
        myRoleText = `You owe ₹${Number(myShare.amountOwed).toFixed(2)}`;
        myRoleColor = '#EF4444';
      }
    } else {
      myRoleText = 'Participating';
    }

    return (
      <TouchableOpacity
        style={[
          styles.splitCard,
          {
            backgroundColor: themeMode === 'dark' ? '#1E293B' : '#FFFFFF',
            borderColor: colors.cardBorder,
          },
        ]}
        onPress={() => setSelectedExpense(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {item.title}
              </Text>
              {item.isOngoingGroup && (
                <View style={styles.ongoingBadge}>
                  <Text style={styles.ongoingBadgeText}>Ongoing Group</Text>
                </View>
              )}
            </View>
            <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
              {dateStr} • {item.participants?.length || 0} people
            </Text>
          </View>

          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: isSettled
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(245, 158, 11, 0.12)',
              },
            ]}
          >
            {isSettled ? (
              <CheckCircle2 size={11} color="#10B981" />
            ) : (
              <Clock size={11} color="#F59E0B" />
            )}
            <Text style={[styles.statusPillText, { color: isSettled ? '#10B981' : '#F59E0B' }]}>
              {isSettled ? 'SETTLED' : 'ACTIVE'}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooterRow}>
          <Text style={[styles.cardRole, { color: myRoleColor }]}>{myRoleText}</Text>
          <View style={styles.amountRightWrap}>
            <Text style={[styles.cardTotalAmount, { color: colors.primaryIndigo }]}>
              ₹{Number(item.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
            <ChevronRight size={16} color={colors.textSecondary} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderNetBalanceItem = ({ item }: { item: any }) => {
    const isOwed = item.status === 'OWES_YOU';
    const amountStr = `₹${item.amount.toFixed(2)}`;
    const contactName = item.user.displayName || item.user.phoneNumber || 'Contact';

    return (
      <View
        style={[
          styles.netBalanceCard,
          {
            backgroundColor: themeMode === 'dark' ? '#1E293B' : '#FFFFFF',
            borderColor: colors.cardBorder,
          },
        ]}
      >
        <View style={styles.netLeft}>
          <View
            style={[
              styles.netAvatar,
              { backgroundColor: isOwed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' },
            ]}
          >
            <Text style={[styles.netAvatarText, { color: isOwed ? '#10B981' : '#EF4444' }]}>
              {contactName.charAt(0).toUpperCase()}
            </Text>
          </View>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.netName, { color: colors.textPrimary }]} numberOfLines={1}>
              {contactName}
            </Text>
            <Text style={[styles.netSubtext, { color: colors.textSecondary }]}>
              Across {item.activeSplitsCount} active{' '}
              {item.activeSplitsCount === 1 ? 'split' : 'splits'}
            </Text>
          </View>
        </View>

        <View style={styles.netRight}>
          <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
            <Text style={[styles.netAmount, { color: isOwed ? '#10B981' : '#EF4444' }]}>
              {amountStr}
            </Text>
            <Text style={[styles.netStatusLabel, { color: isOwed ? '#10B981' : '#EF4444' }]}>
              {isOwed ? 'owes you' : 'you owe'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.settleUpBtn,
              { backgroundColor: isOwed ? 'rgba(16, 185, 129, 0.15)' : colors.primaryIndigo },
            ]}
            onPress={() => {
              setSettleContact({
                id: item.user.id,
                name: contactName,
                phone: item.user.phoneNumber,
                suggestedAmount: item.amount,
                status: item.status,
              });
            }}
          >
            <Text style={[styles.settleUpBtnText, { color: isOwed ? '#10B981' : '#FFFFFF' }]}>
              Settle
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: themeMode === 'dark' ? '#0F172A' : '#F8FAFC' }]}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surface}
      />

      {/* Top Header */}
      <View
        style={[
          styles.topHeader,
          { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
            Hisaab / Splitwise
          </Text>
          <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
            Shared debts, balances & bill settlements
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.headerAddBtn, { backgroundColor: colors.primaryIndigo }]}
          onPress={() => setShowSplitModal(true)}
        >
          <Plus size={16} color="#FFF" />
          <Text style={styles.headerAddBtnText}>Split</Text>
        </TouchableOpacity>
      </View>

      {/* Main Segmented Control: [ Balances (Net) ] vs [ All Expenses ] */}
      <View
        style={[
          styles.mainSegmentWrap,
          { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
        ]}
      >
        <View
          style={[
            styles.mainSegmentBar,
            { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.cardBorder },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.mainSegmentBtn,
              activeMainTab === 'BALANCES' && { backgroundColor: colors.primaryIndigo },
            ]}
            onPress={() => setActiveMainTab('BALANCES')}
          >
            <Scale size={14} color={activeMainTab === 'BALANCES' ? '#FFF' : colors.textSecondary} />
            <Text
              style={[
                styles.mainSegmentBtnText,
                {
                  color: activeMainTab === 'BALANCES' ? '#FFF' : colors.textSecondary,
                  fontWeight: activeMainTab === 'BALANCES' ? '700' : '500',
                },
              ]}
            >
              Net Balances
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.mainSegmentBtn,
              activeMainTab === 'HISTORY' && { backgroundColor: colors.primaryIndigo },
            ]}
            onPress={() => setActiveMainTab('HISTORY')}
          >
            <Receipt
              size={14}
              color={activeMainTab === 'HISTORY' ? '#FFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.mainSegmentBtnText,
                {
                  color: activeMainTab === 'HISTORY' ? '#FFF' : colors.textSecondary,
                  fontWeight: activeMainTab === 'HISTORY' ? '700' : '500',
                },
              ]}
            >
              All Expenses ({splits.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* TAB 1: NET BALANCES (SIMPLIFY DEBTS) */}
      {activeMainTab === 'BALANCES' && (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primaryIndigo}
            />
          }
        >
          {/* Summary Row */}
          <View style={styles.summaryContainer}>
            <View style={styles.subSummaryRow}>
              <View
                style={[
                  styles.subSummaryCard,
                  {
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    borderColor: 'rgba(239, 68, 68, 0.2)',
                  },
                ]}
              >
                <View style={styles.colHeader}>
                  <TrendingDown size={16} color="#EF4444" />
                  <Text style={styles.colTitleRed}>You Owe</Text>
                </View>
                <Text style={styles.colAmountRed}>₹{netSummary.totalYouOwe.toFixed(2)}</Text>
              </View>

              <View
                style={[
                  styles.subSummaryCard,
                  {
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    borderColor: 'rgba(16, 185, 129, 0.2)',
                  },
                ]}
              >
                <View style={styles.colHeader}>
                  <TrendingUp size={16} color="#10B981" />
                  <Text style={styles.colTitleGreen}>You are Owed</Text>
                </View>
                <Text style={styles.colAmountGreen}>₹{netSummary.totalYouAreOwed.toFixed(2)}</Text>
              </View>
            </View>

            {/* Total Net Badge */}
            <View
              style={[
                styles.totalNetBadge,
                {
                  backgroundColor:
                    netSummary.netTotal > 0
                      ? 'rgba(16, 185, 129, 0.12)'
                      : netSummary.netTotal < 0
                        ? 'rgba(239, 68, 68, 0.12)'
                        : 'rgba(255,255,255,0.05)',
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <Text style={[styles.totalNetText, { color: colors.textSecondary }]}>
                Overall Net Balance:{' '}
                <Text
                  style={{
                    fontWeight: '800',
                    color: netSummary.netTotal >= 0 ? '#10B981' : '#EF4444',
                  }}
                >
                  {netSummary.netTotal >= 0
                    ? `+₹${netSummary.netTotal.toFixed(2)}`
                    : `-₹${Math.abs(netSummary.netTotal).toFixed(2)}`}
                </Text>
              </Text>
            </View>
          </View>

          {/* Section Header */}
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitleText, { color: colors.textPrimary }]}>
              Contact Balances ({netBalances.length})
            </Text>
          </View>

          {/* Net Balances List */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
            </View>
          ) : netBalances.length === 0 ? (
            <View style={styles.emptyContainer}>
              <CheckCircle2 size={48} color="#10B981" />
              <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                You are all settled up!
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                No pending debts with anyone. Tap "Split" to create a new expense!
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              {netBalances.map((b) => (
                <View key={b.user.id}>{renderNetBalanceItem({ item: b })}</View>
              ))}
            </View>
          )}

          {/* Recent Settlements Section */}
          {recentSettlements.length > 0 && (
            <View style={{ marginTop: 20, paddingHorizontal: 16, marginBottom: 30 }}>
              <Text
                style={[styles.sectionTitleText, { color: colors.textPrimary, marginBottom: 10 }]}
              >
                Recent Settle-ups
              </Text>
              {recentSettlements.slice(0, 5).map((s) => {
                const isPayer = s.payerId === currentUserId;
                const otherParty = isPayer ? s.receiver : s.payer;
                const name = otherParty?.displayName || otherParty?.phoneNumber || 'Contact';
                const dateStr = new Date(s.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                });
                return (
                  <View
                    key={s.id}
                    style={[
                      styles.settleHistoryCard,
                      { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                    ]}
                  >
                    <HandCoins size={16} color="#10B981" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.settleHistoryText, { color: colors.textPrimary }]}>
                        {isPayer ? `You paid ${name}` : `${name} paid you`}
                      </Text>
                      <Text style={[styles.settleHistoryDate, { color: colors.textSecondary }]}>
                        {dateStr} {s.notes ? `• ${s.notes}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.settleHistoryAmount}>₹{Number(s.amount).toFixed(2)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* TAB 2: ALL EXPENSES HISTORY */}
      {activeMainTab === 'HISTORY' && (
        <View style={{ flex: 1 }}>
          {/* Category Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[
              styles.categoryScroll,
              { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
            ]}
          >
            {CATEGORIES.map((cat) => {
              const isSelected = categoryFilter === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryFilterChip,
                    { borderColor: isSelected ? colors.primaryIndigo : colors.cardBorder },
                    isSelected && { backgroundColor: 'rgba(99, 102, 241, 0.18)' },
                  ]}
                  onPress={() => setCategoryFilter(cat.id)}
                >
                  <Text style={styles.categoryFilterIcon}>{cat.icon}</Text>
                  <Text
                    style={[
                      styles.categoryFilterLabel,
                      {
                        color: isSelected ? colors.primaryIndigo : colors.textSecondary,
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

          {/* Status Tabs */}
          <View style={[styles.filterBar, { borderBottomColor: colors.cardBorder }]}>
            {(['ALL', 'ACTIVE', 'SETTLED'] as const).map((tab) => {
              const isSelected = statusFilter === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[
                    styles.filterTab,
                    isSelected && {
                      borderBottomColor: colors.primaryIndigo,
                      borderBottomWidth: 2,
                    },
                  ]}
                  onPress={() => setStatusFilter(tab)}
                >
                  <Text
                    style={[
                      styles.filterTabText,
                      {
                        color: isSelected ? colors.primaryIndigo : colors.textSecondary,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {tab === 'ALL'
                      ? `All (${splits.length})`
                      : tab === 'ACTIVE'
                        ? `Active (${summary.activeCount})`
                        : `Settled (${summary.settledCount})`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Expenses List */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
            </View>
          ) : (
            <FlatList
              data={filteredSplits}
              keyExtractor={(item) => item.id}
              renderItem={renderSplitItem}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primaryIndigo}
                />
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Receipt size={48} color={colors.textSecondary} />
                  <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                    No expenses found
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                    {categoryFilter !== 'ALL'
                      ? `No ${categoryFilter.toLowerCase()} expenses found.`
                      : 'Tap "+ Split" to split a bill with friends!'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* Split Details Modal */}
      <Modal
        visible={!!selectedExpense}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedExpense(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.detailModalCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.detailModalHeader}>
              <Text style={[styles.detailModalTitle, { color: colors.textPrimary }]}>
                Split Details
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedExpense(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={selectedExpense ? [selectedExpense] : []}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <ExpenseCard
                  expense={item}
                  onUpdated={(updated) => {
                    setSelectedExpense(updated);
                    fetchData();
                  }}
                  onDeleted={() => {
                    setSelectedExpense(null);
                    fetchData();
                  }}
                />
              )}
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          </View>
        </View>
      </Modal>

      {/* Split Bill Creation Modal */}
      <SplitBillModal
        visible={showSplitModal}
        onClose={() => setShowSplitModal(false)}
        defaultParticipants={[]}
        onSuccess={() => {
          fetchData();
        }}
        colors={colors}
      />

      {/* Settle Up Direct Modal */}
      <SettleUpModal
        visible={!!settleContact}
        contact={settleContact}
        onClose={() => setSettleContact(null)}
        onSuccess={() => {
          fetchData();
        }}
        colors={colors}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    marginRight: 14,
  },
  headerTitleGroup: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  screenSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  headerAddBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  mainSegmentWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  mainSegmentBar: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
  },
  mainSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 9,
    gap: 6,
  },
  mainSegmentBtnText: {
    fontSize: 13,
  },
  summaryContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  subSummaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  subSummaryCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  colTitleRed: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  colTitleGreen: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
  },
  colAmountRed: {
    fontSize: 20,
    fontWeight: '800',
    color: '#EF4444',
  },
  colAmountGreen: {
    fontSize: 20,
    fontWeight: '800',
    color: '#10B981',
  },
  totalNetBadge: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  totalNetText: {
    fontSize: 13,
  },
  sectionTitleRow: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  netBalanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 5,
  },
  netLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  netAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netAvatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  netName: {
    fontSize: 15,
    fontWeight: '600',
  },
  netSubtext: {
    fontSize: 11,
    marginTop: 2,
  },
  netRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  netAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  netStatusLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  settleUpBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    marginLeft: 6,
  },
  settleUpBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  settleHistoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 4,
  },
  settleHistoryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  settleHistoryDate: {
    fontSize: 11,
    marginTop: 2,
  },
  settleHistoryAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  categoryScroll: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    flexGrow: 0,
  },
  categoryFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
    gap: 4,
  },
  categoryFilterIcon: {
    fontSize: 12,
  },
  categoryFilterLabel: {
    fontSize: 12,
  },
  filterBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
  },
  filterTabText: {
    fontSize: 13,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  splitCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  ongoingBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  ongoingBadgeText: {
    fontSize: 9,
    color: '#10B981',
    fontWeight: '700',
  },
  cardDate: {
    fontSize: 11,
    marginTop: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 8,
  },
  cardRole: {
    fontSize: 12,
    fontWeight: '600',
  },
  amountRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardTotalAmount: {
    fontSize: 16,
    fontWeight: '800',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  detailModalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '90%',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  detailModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  detailModalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
});
