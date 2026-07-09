import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/api';
import { colors, radius } from '@/theme';
import { CheckCircle2, XCircle, AlertCircle, ScanLine } from 'lucide-react-native';

export default function AuditDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [audit, setAudit] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [a, s] = await Promise.all([
        api.get(`/audits/${id}`),
        api.get(`/audits/${id}/summary`),
      ]);
      setAudit(a.data); setSummary(s.data);
    } finally { setLoading(false); setRefreshing(false); }
  }
  useFocusEffect(useCallback(() => { load(); }, [id]));

  async function scan() {
    if (!tag.trim()) return;
    setBusy(true);
    try {
      await api.post(`/audits/${id}/scan`, { assetTag: tag.trim().toUpperCase() });
      setTag('');
      load();
    } catch (e: any) {
      Alert.alert('Scan failed', e.response?.data?.message ?? 'Try again');
    } finally { setBusy(false); }
  }

  async function variance(lineId: string, kind: string) {
    try {
      await api.post(`/audits/lines/${lineId}/variance`, { variance: kind });
      load();
    } catch (e: any) { Alert.alert('Failed', e.response?.data?.message ?? ''); }
  }

  async function complete() {
    Alert.alert('Complete audit?', 'Unfound items will be flagged Missing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete', style: 'destructive',
        onPress: async () => {
          await api.post(`/audits/${id}/complete`);
          load();
        },
      },
    ]);
  }

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color={colors.brand}/></View>;
  if (!audit) return null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}/>}
    >
      {/* Header */}
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.3 }}>{audit.code}</Text>
        <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 4 }}>
          {audit.store?.code} · {audit.store?.name}
        </Text>
        <Text style={{ color: audit.status === 'COMPLETED' ? colors.success : colors.brand, marginTop: 4, fontWeight: '700', letterSpacing: 1.2, fontSize: 11 }}>
          {audit.status}
        </Text>
      </View>

      {/* Summary tiles */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Tile label="Expected"   value={summary?.total ?? '—'} tone={colors.textMuted} />
        <Tile label="Found"      value={summary?.found ?? '—'} tone={colors.success} />
        <Tile label="Missing"    value={summary?.missing ?? '—'} tone={colors.danger} />
        <Tile label="Unrecorded" value={summary?.unrecorded ?? '—'} tone={colors.warn} />
      </View>

      {/* Scan */}
      {audit.status !== 'COMPLETED' && (
        <View style={{ marginTop: 16, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <ScanLine size={14} color={colors.brand} />
            <Text style={{ color: colors.textMuted, fontWeight: '700', letterSpacing: 1.3, fontSize: 11 }}>SCAN OR ENTER TAG</Text>
          </View>
          <TextInput
            value={tag} onChangeText={(t) => setTag(t.toUpperCase())}
            placeholder="FF-POS-G-001" placeholderTextColor={colors.textMuted}
            style={{
              backgroundColor: colors.bgElev, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm,
              color: colors.textPrimary, padding: 10, fontFamily: 'monospace',
            }}
          />
          <TouchableOpacity
            disabled={!tag.trim() || busy}
            onPress={scan}
            style={{ marginTop: 8, backgroundColor: colors.brand, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', opacity: !tag.trim() || busy ? 0.5 : 1 }}>
            {busy ? <ActivityIndicator color="#fff"/> : <Text style={{ color: '#fff', fontWeight: '800' }}>Confirm</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Lines */}
      <View style={{ marginTop: 16, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ color: colors.textMuted, fontWeight: '700', letterSpacing: 1.4, fontSize: 11 }}>LINES</Text>
        </View>
        {audit.lines?.map((l: any) => (
          <View key={l.id} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '60' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {l.found
                ? <CheckCircle2 size={16} color={colors.success}/>
                : l.variance
                  ? <XCircle size={16} color={colors.danger}/>
                  : <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}/>}
              <Text style={{ color: colors.textPrimary, fontFamily: 'monospace', fontSize: 13, flex: 1 }}>
                {l.asset?.assetTag ?? '(unrecorded)'}
              </Text>
              {l.variance && <Text style={{ color: l.variance === 'MISSING' ? colors.danger : colors.warn, fontSize: 10, fontWeight: '800' }}>{l.variance}</Text>}
            </View>
            {l.asset?.sku && (
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4, marginLeft: 24 }}>
                {l.asset.sku.model}
              </Text>
            )}
            {audit.status !== 'COMPLETED' && !l.variance && !l.found && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginLeft: 24 }}>
                <TouchableOpacity onPress={() => variance(l.id, 'DAMAGED')} style={{ flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.warn + '20', borderRadius: 999, borderWidth: 1, borderColor: colors.warn + '40' }}>
                  <AlertCircle size={11} color={colors.warn}/>
                  <Text style={{ color: colors.warn, fontSize: 11, fontWeight: '700' }}>Damaged</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => variance(l.id, 'MISSING')} style={{ flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.danger + '20', borderRadius: 999, borderWidth: 1, borderColor: colors.danger + '40' }}>
                  <XCircle size={11} color={colors.danger}/>
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Missing</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {(audit.lines?.length ?? 0) === 0 && (
          <View style={{ padding: 16 }}><Text style={{ color: colors.textMuted, fontSize: 13 }}>No expected assets at this store.</Text></View>
        )}
      </View>

      {audit.status !== 'COMPLETED' && (
        <TouchableOpacity
          onPress={complete}
          style={{
            marginTop: 16, backgroundColor: colors.success, paddingVertical: 12,
            borderRadius: radius.md, alignItems: 'center',
          }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Complete audit</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Tile({ label, value, tone }: { label: string; value: any; tone: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
      <Text style={{ color: tone, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 4 }}>{value}</Text>
    </View>
  );
}
