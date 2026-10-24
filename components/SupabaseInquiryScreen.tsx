import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppAccess } from '../contexts/AppAccessContext';
import { createInquiry, getInquiries, resolveInquiry, type Inquiry } from '../lib/inquiryData';
import { AppGuide } from './AppGuide';

function koreaDate(value: string) {
  return new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}

function confirmResolve(action: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm('이 문의를 해결 상태로 변경할까요?')) action();
  } else Alert.alert('문의 해결', '이 문의를 해결 상태로 변경할까요?', [
    { text: '취소', style: 'cancel' }, { text: '해결', onPress: action },
  ]);
}

export default function SupabaseInquiryScreen() {
  const { access } = useAppAccess();
  const canManage = access?.app_role === 'manager' || access?.app_role === 'admin';
  const [content, setContent] = useState('');
  const [items, setItems] = useState<Inquiry[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setItems(await getInquiries()); }
    catch (cause: any) { setError(cause?.message || '문의 내역을 불러오지 못했습니다.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const own = useMemo(() => items.filter((item) => item.requesterStaffId === access?.staff_id), [items, access?.staff_id]);
  const managed = useMemo(() => items.filter((item) => filter === 'all' || item.status === filter), [items, filter]);

  async function submit() {
    if (!access?.staff_id || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await createInquiry(access.staff_id, content);
      setContent(''); setNotice('문의가 접수되었습니다.');
      await load();
    } catch (cause: any) { setError(cause?.message || '문의를 접수하지 못했습니다.'); }
    finally { setSaving(false); }
  }

  async function markResolved(id: string) {
    setError(''); setNotice('');
    try { await resolveInquiry(id); setNotice('해결 상태로 변경했습니다.'); await load(); }
    catch (cause: any) { setError(cause?.message || '문의 상태를 변경하지 못했습니다.'); }
  }

  function renderItem(item: Inquiry, managerView = false) {
    return <View key={item.id} style={[styles.item, item.status === 'resolved' && styles.resolved]}>
      <View style={styles.itemBody}>
        {managerView && <Text style={styles.name}>{item.requesterName}</Text>}
        <Text style={styles.date}>{koreaDate(item.createdAt)}</Text>
        <Text style={styles.body}>{item.content}</Text>
      </View>
      {managerView && item.status === 'open' ? <Pressable style={styles.resolveButton}
        onPress={() => confirmResolve(() => void markResolved(item.id))}>
        <Text style={styles.resolveText}>해결 처리</Text>
      </Pressable> : <Text style={[styles.status, item.status === 'resolved' && styles.done]}>
        {item.status === 'resolved' ? '해결됨' : '접수됨'}
      </Text>}
    </View>;
  }

  return <ScrollView contentContainerStyle={styles.container}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <Text style={styles.title}>문의하기</Text>
    <Text style={styles.subtitle}>건의사항이나 궁금한 점을 남겨주세요.</Text>
    <AppGuide />
    <View style={styles.card}>
      <Text style={styles.profile}>이름  {access?.full_name || '-'}</Text>
      <Text style={styles.label}>문의 내용</Text>
      <TextInput style={styles.input} multiline textAlignVertical="top" value={content} onChangeText={setContent}
        placeholder="문의 내용을 자세히 적어주세요." placeholderTextColor="#9CA3AF" />
      <Pressable disabled={saving || !content.trim()} style={[styles.submit, (saving || !content.trim()) && styles.disabled]} onPress={() => void submit()}>
        <Text style={styles.submitText}>{saving ? '접수 중...' : '문의 접수'}</Text>
      </Pressable>
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!!notice && <Text style={styles.notice}>{notice}</Text>}
    {loading ? <ActivityIndicator color="#4F46E5" /> : <>
      <Text style={styles.sectionTitle}>내 문의 내역</Text>
      {own.length === 0 ? <Text style={styles.empty}>등록한 문의가 없습니다.</Text> : own.map((item) => renderItem(item))}
      {canManage && <>
        <Text style={styles.sectionTitle}>문의 관리</Text>
        <View style={styles.filters}>{([['all', '전체'], ['open', '미해결'], ['resolved', '해결됨']] as const).map(([value, label]) =>
          <Pressable key={value} style={[styles.chip, filter === value && styles.activeChip]} onPress={() => setFilter(value)}>
            <Text style={[styles.chipText, filter === value && styles.activeChipText]}>{label}</Text>
          </Pressable>)}</View>
        {managed.length === 0 ? <Text style={styles.empty}>내역이 없습니다.</Text> : managed.map((item) => renderItem(item, true))}
      </>}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, paddingBottom: 50, backgroundColor: '#F6F7FB' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  subtitle: { color: '#6B7280', marginTop: 5, marginBottom: 18 },
  card: { padding: 18, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  profile: { color: '#374151', fontWeight: '700', marginBottom: 16 },
  label: { color: '#374151', fontWeight: '700', marginBottom: 8 },
  input: { minHeight: 120, padding: 12, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, backgroundColor: '#F9FAFB', fontSize: 15 },
  submit: { marginTop: 14, backgroundColor: '#4F46E5', padding: 13, borderRadius: 8, alignItems: 'center' },
  submitText: { color: '#FFFFFF', fontWeight: '800' }, disabled: { opacity: 0.5 },
  error: { marginTop: 12, color: '#B91C1C' }, notice: { marginTop: 12, color: '#047857' },
  sectionTitle: { marginTop: 24, marginBottom: 12, fontSize: 18, fontWeight: '800', color: '#111827' },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: '#E5E7EB' },
  activeChip: { backgroundColor: '#4F46E5' }, chipText: { color: '#374151', fontWeight: '700' }, activeChipText: { color: '#FFFFFF' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', marginBottom: 9 },
  resolved: { opacity: 0.7 }, itemBody: { flex: 1 }, name: { color: '#111827', fontWeight: '800' },
  date: { color: '#9CA3AF', fontSize: 12, marginTop: 3 }, body: { color: '#374151', marginTop: 7, lineHeight: 21 },
  status: { color: '#991B1B', fontWeight: '700', fontSize: 12 }, done: { color: '#065F46' },
  resolveButton: { backgroundColor: '#D1FAE5', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  resolveText: { color: '#065F46', fontWeight: '800', fontSize: 12 },
  empty: { textAlign: 'center', color: '#6B7280', marginVertical: 16 },
});
