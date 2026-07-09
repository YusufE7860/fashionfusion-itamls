import { useEffect, useState } from 'react';
import { ScrollView, View, Text, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { colors, radius } from '@/theme';
import { Boxes, ShieldAlert, Warehouse, Bell } from 'lucide-react-native';

export default function Home() {
  const user = useAuth((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>({});

  async function load() {
    try {
      const [w, a, alerts] = await Promise.all([
        api.get('/warranties/dashboard').catch(() => ({ data: {} })),
        api.get('/assets').catch(() => ({ data: [] })),
        api.get('/alerts/summary').catch(() => ({ data: {} })),
      ]);
      setData({ warranty: w.data, assetCount: a.data.length ?? 0, alerts: alerts.data });
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={colors.brand}/>
    </View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 2 }}>WELCOME BACK</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 }}>
        {user?.fullName ?? 'Technician'}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
        {user?.role.replaceAll('_',' ')}
      </Text>

      <View style={{ marginTop: 20, gap: 12 }}>
        <Tile icon={Boxes} label="Assets in scope" value={String(data.assetCount)} tone={colors.brand} />
        <Tile icon={Bell} label="Active alerts" value={String(data.alerts?.active ?? 0)} tone={colors.danger} />
        <Tile icon={ShieldAlert} label="Warranty: 30 days" value={String(data.warranty?.expiring30 ?? 0)} tone={colors.warn} />
        <Tile icon={Warehouse} label="Warranty: 90 days" value={String(data.warranty?.expiring90 ?? 0)} tone={colors.gold} />
      </View>
    </ScrollView>
  );
}

function Tile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border,
      padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
    }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' }}>{label.toUpperCase()}</Text>
        <Text style={{ color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{value}</Text>
      </View>
    </View>
  );
}
