import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TextInput,
  Platform,
  Share,
} from 'react-native';
import {
  devInspector,
  ApiLogEntry,
  UiLogEntry,
  SocketLogEntry,
} from '../services/devInspectorService';
import { invalidateContactsCache } from '../services/contactsService';
import {
  X,
  Activity,
  Server,
  Zap,
  Radio,
  Layers,
  Trash2,
  Share2,
  Search,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';

export const DevInspectorModal: React.FC = () => {
  const [visible, setVisible] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'api' | 'ui' | 'socket' | 'system'>('api');
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [uiLogs, setUiLogs] = useState<UiLogEntry[]>([]);
  const [socketLogs, setSocketLogs] = useState<SocketLogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [pingStatus, setPingStatus] = useState<string | null>(null);

  const [showFloatingPill, setShowFloatingPill] = useState<boolean>(false);

  useEffect(() => {
    const updateLogs = () => {
      setApiLogs(devInspector.getApiLogs());
      setUiLogs(devInspector.getUiLogs());
      setSocketLogs(devInspector.getSocketLogs());
      setVisible(devInspector.getIsVisible());
    };

    updateLogs();
    const unsubscribe = devInspector.subscribe(updateLogs);
    return () => unsubscribe();
  }, []);

  const handleClear = () => {
    devInspector.clearAllLogs();
  };

  const handleInvalidateCache = () => {
    invalidateContactsCache();
    setPingStatus('Cache Invalidated! Next sync will hit backend fresh.');
    setTimeout(() => setPingStatus(null), 3000);
  };

  const handleExportLogs = async () => {
    const report = {
      exportedAt: new Date().toISOString(),
      apiLogs,
      uiLogs,
      socketLogs,
    };
    try {
      await Share.share({
        title: 'Chat App Diagnostics Report',
        message: JSON.stringify(report, null, 2),
      });
    } catch (e) {}
  };

  const filteredApiLogs = apiLogs.filter(
    (log) =>
      log.url.toLowerCase().includes(searchFilter.toLowerCase()) ||
      log.method.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (log.fromRedisCache ? 'redis' : '').includes(searchFilter.toLowerCase()),
  );

  const redisHitsCount = apiLogs.filter((l) => l.fromRedisCache).length;
  const avgLatency =
    apiLogs.length > 0
      ? Math.round(apiLogs.reduce((acc, l) => acc + l.durationMs, 0) / apiLogs.length)
      : 0;

  return (
    <>
      {/* Floating Developer Badge (Only shown if toggled, positioned at top-right corner) */}
      {showFloatingPill && (
        <View style={styles.floatingBadgeContainer}>
          <TouchableOpacity
            style={styles.floatingBadge}
            activeOpacity={0.85}
            onPress={() => devInspector.setVisible(true)}
          >
            <Activity size={12} color="#FFF" style={{ marginRight: 4 }} />
            <Text style={styles.floatingBadgeText}>DEV</Text>
            {apiLogs.length > 0 && (
              <View style={styles.badgeCounter}>
                <Text style={styles.badgeCounterText}>{apiLogs.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingBadgeClose}
            onPress={() => setShowFloatingPill(false)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={12} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Developer Diagnostics Fullscreen Modal */}
      <Modal
        visible={visible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => devInspector.setVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />

          {/* Top Inspector Header */}
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.headerIconBox}>
                <Zap size={18} color="#6366F1" />
              </View>
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.modalHeaderTitle}>Developer Live Inspector</Text>
                <Text style={styles.modalHeaderSubtitle}>
                  Real-time API, Redis Cache, UI Renders & WebSockets
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => devInspector.setVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Metrics Quick Strip */}
          <View style={styles.metricsStrip}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{apiLogs.length}</Text>
              <Text style={styles.metricLabel}>Total Calls</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: '#10B981' }]}>{redisHitsCount}</Text>
              <Text style={styles.metricLabel}>Redis Hits ⚡</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: '#F59E0B' }]}>{avgLatency}ms</Text>
              <Text style={styles.metricLabel}>Avg Latency</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricValue, { color: '#38BDF8' }]}>{uiLogs.length}</Text>
              <Text style={styles.metricLabel}>UI Mounts</Text>
            </View>
          </View>

          {/* Tab Selection Bar */}
          <View style={styles.tabBar}>
            {[
              { key: 'api', label: `API Calls (${apiLogs.length})`, icon: Server },
              { key: 'ui', label: `UI Mounts (${uiLogs.length})`, icon: Layers },
              { key: 'socket', label: `Sockets (${socketLogs.length})`, icon: Radio },
              { key: 'system', label: 'System Health', icon: Activity },
            ].map((tab) => {
              const isSelected = activeTab === tab.key;
              const IconComp = tab.icon;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tabButton, isSelected && styles.tabButtonActive]}
                  onPress={() => setActiveTab(tab.key as any)}
                >
                  <IconComp
                    size={14}
                    color={isSelected ? '#FFF' : '#64748B'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.tabButtonText, isSelected && styles.tabButtonTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Tab Content */}
          <View style={{ flex: 1 }}>
            {activeTab === 'api' && (
              <View style={{ flex: 1 }}>
                {/* Search Bar & Action Buttons */}
                <View style={styles.filterRow}>
                  <View style={styles.searchBox}>
                    <Search size={16} color="#64748B" style={{ marginRight: 8 }} />
                    <TextInput
                      style={styles.filterInput}
                      placeholder="Filter by endpoint or status..."
                      placeholderTextColor="#64748B"
                      value={searchFilter}
                      onChangeText={setSearchFilter}
                    />
                  </View>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleClear}>
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleExportLogs}>
                    <Share2 size={16} color="#6366F1" />
                  </TouchableOpacity>
                </View>

                {/* API Log List */}
                <ScrollView style={{ flex: 1, paddingHorizontal: 14 }}>
                  {filteredApiLogs.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Server size={32} color="#334155" />
                      <Text style={styles.emptyText}>No API calls recorded yet.</Text>
                      <Text style={styles.emptySubText}>
                        Perform an action (Login, Sync Contacts, Send Message) to see live
                        telemetry.
                      </Text>
                    </View>
                  ) : (
                    filteredApiLogs.map((log) => {
                      const isExpanded = expandedId === log.id;
                      const isSuccess = log.status >= 200 && log.status < 300;
                      const shortUrl = log.url.replace(/^https?:\/\/[^\/]+/, '');

                      return (
                        <View key={log.id} style={styles.logCard}>
                          <TouchableOpacity
                            style={styles.logHeader}
                            onPress={() => setExpandedId(isExpanded ? null : log.id)}
                            activeOpacity={0.8}
                          >
                            <View style={{ flex: 1 }}>
                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  marginBottom: 4,
                                }}
                              >
                                <View
                                  style={[
                                    styles.methodBadge,
                                    {
                                      backgroundColor:
                                        log.method === 'POST' ? '#3B82F6' : '#10B981',
                                    },
                                  ]}
                                >
                                  <Text style={styles.methodText}>{log.method}</Text>
                                </View>
                                <Text style={styles.urlText} numberOfLines={1}>
                                  {shortUrl}
                                </Text>
                              </View>

                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 6,
                                }}
                              >
                                <View
                                  style={[
                                    styles.statusBadge,
                                    {
                                      backgroundColor: isSuccess
                                        ? 'rgba(16, 185, 129, 0.15)'
                                        : 'rgba(239, 68, 68, 0.15)',
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusText,
                                      { color: isSuccess ? '#10B981' : '#EF4444' },
                                    ]}
                                  >
                                    {log.status === 0
                                      ? 'NETWORK_ERR'
                                      : `${log.status} ${isSuccess ? 'OK' : 'ERR'}`}
                                  </Text>
                                </View>

                                <View style={styles.durationBadge}>
                                  <Text style={styles.durationText}>{log.durationMs}ms</Text>
                                </View>

                                {log.fromRedisCache && (
                                  <View style={styles.redisBadge}>
                                    <Zap size={10} color="#F59E0B" style={{ marginRight: 3 }} />
                                    <Text style={styles.redisText}>REDIS CACHE HIT</Text>
                                  </View>
                                )}

                                <Text style={styles.timeText}>{log.timestamp}</Text>
                              </View>
                            </View>

                            {isExpanded ? (
                              <ChevronUp size={18} color="#94A3B8" />
                            ) : (
                              <ChevronDown size={18} color="#94A3B8" />
                            )}
                          </TouchableOpacity>

                          {/* Expanded JSON Inspector */}
                          {isExpanded && (
                            <View style={styles.expandedSection}>
                              <Text style={styles.jsonTitle}>REQUEST BODY:</Text>
                              <View style={styles.jsonBox}>
                                <Text style={styles.jsonText}>
                                  {JSON.stringify(log.requestData, null, 2) ||
                                    'None (Empty payload)'}
                                </Text>
                              </View>

                              <Text style={[styles.jsonTitle, { marginTop: 10 }]}>
                                RESPONSE PAYLOAD:
                              </Text>
                              <View style={styles.jsonBox}>
                                <Text style={styles.jsonText}>
                                  {JSON.stringify(log.responseData, null, 2) ||
                                    log.error ||
                                    'Empty'}
                                </Text>
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            )}

            {activeTab === 'ui' && (
              <ScrollView style={{ flex: 1, padding: 14 }}>
                <View style={styles.filterRow}>
                  <Text style={styles.sectionHeader}>UI Component & Tab Lifecycle Events</Text>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleClear}>
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                {uiLogs.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Layers size={32} color="#334155" />
                    <Text style={styles.emptyText}>No UI mount events recorded yet.</Text>
                  </View>
                ) : (
                  uiLogs.map((log) => (
                    <View key={log.id} style={styles.uiCard}>
                      <View style={styles.uiDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.uiScreen}>{log.screen}</Text>
                        <Text style={styles.uiAction}>
                          Action:{' '}
                          <Text style={{ color: '#38BDF8' }}>{log.action.toUpperCase()}</Text>
                          {log.details ? ` • ${log.details}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.timeText}>{log.timestamp}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            {activeTab === 'socket' && (
              <ScrollView style={{ flex: 1, padding: 14 }}>
                <View style={styles.filterRow}>
                  <Text style={styles.sectionHeader}>Realtime WebSocket Telemetry</Text>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleClear}>
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                {socketLogs.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Radio size={32} color="#334155" />
                    <Text style={styles.emptyText}>No socket events recorded yet.</Text>
                  </View>
                ) : (
                  socketLogs.map((log) => (
                    <View key={log.id} style={styles.logCard}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View
                            style={[
                              styles.methodBadge,
                              { backgroundColor: log.type === 'incoming' ? '#10B981' : '#A855F7' },
                            ]}
                          >
                            <Text style={styles.methodText}>{log.type.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.urlText}>{log.event}</Text>
                        </View>
                        <Text style={styles.timeText}>{log.timestamp}</Text>
                      </View>

                      {log.data && (
                        <View style={[styles.jsonBox, { marginTop: 8 }]}>
                          <Text style={styles.jsonText}>{JSON.stringify(log.data, null, 2)}</Text>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            {activeTab === 'system' && (
              <ScrollView style={{ flex: 1, padding: 16 }}>
                <Text style={styles.sectionHeader}>SERVER & REDIS CONFIGURATION</Text>

                <View style={styles.systemCard}>
                  <View style={styles.systemRow}>
                    <Text style={styles.systemKey}>Backend API Endpoint</Text>
                    <Text style={styles.systemVal}>http://10.36.162.14:3000/api/v1</Text>
                  </View>
                  <View style={styles.systemRow}>
                    <Text style={styles.systemKey}>WebSocket Gateway</Text>
                    <Text style={styles.systemVal}>http://10.36.162.14:3000</Text>
                  </View>
                  <View style={styles.systemRow}>
                    <Text style={styles.systemKey}>Redis Caching</Text>
                    <Text style={[styles.systemVal, { color: '#10B981' }]}>
                      ENABLED (5-min TTL)
                    </Text>
                  </View>
                  <View style={styles.systemRow}>
                    <Text style={styles.systemKey}>Phone Format</Text>
                    <Text style={styles.systemVal}>Strict 10-Digits Normalized</Text>
                  </View>
                </View>

                {pingStatus && (
                  <View style={styles.pingAlert}>
                    <CheckCircle size={16} color="#10B981" style={{ marginRight: 6 }} />
                    <Text style={styles.pingAlertText}>{pingStatus}</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.systemBtn} onPress={handleInvalidateCache}>
                  <RefreshCw size={16} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.systemBtnText}>Clear Local & Server Contacts Cache</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  floatingBadgeContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 36,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 99999,
  },
  floatingBadge: {
    backgroundColor: '#6366F1',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  floatingBadgeClose: {
    backgroundColor: '#475569',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  floatingBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeCounter: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 4,
  },
  badgeCounterText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeaderTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  modalHeaderSubtitle: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#1E293B',
    borderRadius: 16,
  },
  metricsStrip: {
    flexDirection: 'row',
    backgroundColor: '#131C2E',
    marginHorizontal: 14,
    marginVertical: 10,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'space-around',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1E293B',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#6366F1',
  },
  tabButtonText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: '#FFF',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131C2E',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  filterInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 12,
  },
  actionBtn: {
    width: 38,
    height: 38,
    backgroundColor: '#131C2E',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  logCard: {
    backgroundColor: '#131C2E',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  methodBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 8,
  },
  methodText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  urlText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  durationBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  redisBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  redisText: {
    color: '#F59E0B',
    fontSize: 9,
    fontWeight: '800',
  },
  timeText: {
    color: '#64748B',
    fontSize: 10,
  },
  expandedSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  jsonTitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  jsonBox: {
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  jsonText: {
    color: '#38BDF8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubText: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  sectionHeader: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    flex: 1,
  },
  uiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131C2E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  uiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    marginRight: 10,
  },
  uiScreen: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  uiAction: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  systemCard: {
    backgroundColor: '#131C2E',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  systemRow: {
    marginBottom: 10,
  },
  systemKey: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  systemVal: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  pingAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  pingAlertText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  systemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  systemBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
