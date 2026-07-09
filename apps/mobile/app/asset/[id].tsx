import { useEffect, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, Alert, TouchableOpacity, TextInput, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '@/api';
import { colors, radius } from '@/theme';
import { Wrench, X } from 'lucide-react-native';

export default function AssetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [asset, setAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFault, setShowFault] = useState(false);
  const [faultDesc, setFaultDesc] = useState('');
  const [warrantyClaim, setWarrantyClaim] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/assets/${id}`);
      setAsset(data);
    } catch (e: any) {
      Alert.alert('Not found', e.response?.data?.message ?? 'Asset lookup failed');
    } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function logFault() {
    if (!faultDesc.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/repairs', { assetId: id, faultDesc, warrantyClaim });
      Alert.alert('Logged', 'Fault has been logged.');
      setShowFault(false); setFaultDesc('');
      load();
    } catch (e: any) {
      Alert.alert('Failed', e.response?.data?.message ?? 'Could not log fault');
    } finally { setSubmitting(false); }
  }

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color={colors.brand} /></View>;
  if (!asset) return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{
        backgroundColor: colors.card, borderRadius: radius.lg,
        borderWidth: 1, borderColor: colors.border, padding: 16,
      }}>
        <Text style={{ color: colors.brand, fontFamily: 'monospace', fontSize: 11, letterSpacing: 1.5 }}>
          {asset.assetTag}
        </Text>
        <Text style={{ color: colors.textPrimary, fontWeight: '800', fontSize: 22, marginTop: 4 }}>
          {asset.sku.manufacturer} {asset.sku.model}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
          {asset.sku.category.name}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pill label={asset.status} tone={pillTone(asset.status)} />
        </View>
      </View>

      <Section title="Overview">
        <Field label="Serial"    value={asset.serialNo ?? '—'} />
        <Field label="Location"  value={asset.location?.name ?? '—'} />
        <Field label="Store"     value={asset.assignedStore?.name ?? '—'} />
        <Field label="Warranty"  value={asset.warrantyExpiry ? new Date(asset.warrantyExpiry).toLocaleDateString() : '—'} />
        <Field label="Supplier"  value={asset.supplier?.name ?? '—'} />
      </Section>

      {showFault ? (
        <View style={{
          marginTop: 16, backgroundColor: colors.card, borderRadius: radius.lg,
          borderWidth: 1, borderColor: colors.brand, padding: 16,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: colors.textMuted, fontWeight: '700', letterSpacing: 1.4, fontSize: 11 }}>LOG A FAULT</Text>
            <TouchableOpacity onPress={() => setShowFault(false)}><X size={18} color={colors.textMuted}/></TouchableOpacity>
          </View>
          <TextInput
            value={faultDesc} onChangeText={setFaultDesc}
            placeholder="Describe the fault…" placeholderTextColor={colors.textMuted}
            multiline numberOfLines={3}
            style={{
              backgroundColor: colors.bgElev, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm,
              color: colors.textPrimary, padding: 10, minHeight: 90, textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 }}>
            <Switch value={warrantyClaim} onValueChange={setWarrantyClaim} thumbColor={colors.brand} trackColor={{ true: colors.brand + '70', false: colors.border }} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>This is a warranty claim</Text>
          </View>
          <TouchableOpacity
            disabled={!faultDesc.trim() || submitting}
            onPress={logFault}
            style={{
              marginTop: 14, backgroundColor: colors.brand, paddingVertical: 12,
              borderRadius: radius.md, alignItems: 'center', opacity: !faultDesc.trim() || submitting ? 0.5 : 1,
            }}>
            {submitting ? <ActivityIndicator color="#fff"/> :
              <Text style={{ color: '#fff', fontWeight: '800' }}>Log fault</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={{
            marginTop: 16, backgroundColor: colors.brand,
            paddingVertical: 12, borderRadius: radius.md,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onPress={() => setShowFault(true)}
        >
          <Wrench size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>Log a fault</Text>
        </TouchableOpacity>
      )}

      <Section title="History">
        {asset.history?.slice(0, 15).map((h: any) => (
          <View key={h.id} style={{ borderLeftWidth: 2, borderLeftColor: colors.brand, paddingLeft: 10, marginBottom: 10 }}>
            <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
              {h.eventType.replaceAll('_', ' ')}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
              {new Date(h.occurredAt).toLocaleString()}
            </Text>
            {h.toLoc && <Text style={{ color: colors.textMuted, fontSize: 11 }}>→ {h.toLoc.name}</Text>}
          </View>
        ))}
        {asset.history?.length === 0 && (
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>No history yet.</Text>
        )}
      </Section>

      {asset.repairs?.length > 0 && (
        <Section title="Open / Recent Repairs">
          {asset.repairs.map((r: any) => (
            <View key={r.id} style={{ marginBottom: 10 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.2 }}>{r.code}</Text>
              <Text style={{ color: colors.textPrimary, fontSize: 14 }}>{r.faultDesc}</Text>
              <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{r.status}</Text>
            </View>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={{
      marginTop: 16, backgroundColor: colors.card, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, padding: 16,
    }}>
      <Text style={{ color: colors.textMuted, fontWeight: '700', letterSpacing: 1.4, fontSize: 11, marginBottom: 12 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: colors.textMuted, fontSize: 10, letterSpacing: 1.3, fontWeight: '700' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 14, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={{
      backgroundColor: tone + '22', borderColor: tone + '55', borderWidth: 1,
      paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
    }}>
      <Text style={{ color: tone, fontWeight: '700', fontSize: 11, letterSpacing: 1 }}>
        {label.replaceAll('_',' ')}
      </Text>
    </View>
  );
}

function pillTone(status: string) {
  if (status === 'IN_STORE') return colors.success;
  if (status === 'IN_STOCK') return '#38bdf8';
  if (status === 'IN_TRANSIT' || status === 'REPAIR') return colors.warn;
  if (status === 'DAMAGED' || status === 'LOST') return colors.danger;
  return colors.textMuted;
}
