import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { colors, radius } from '@/theme';
import { Truck, ArrowRight } from 'lucide-react-native';

export default function TransfersScreen() {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/ibt');
      setData(data);
    } finally { setLoading(false); setRefreshing(false); }
  }
  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color={colors.brand} /></View>;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={data}
      keyExtractor={(it) => it.id}
      refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingVertical: 60 }}>
          <Truck color={colors.textMuted} size={42} />
          <Text style={{ color: colors.textMuted, marginTop: 10 }}>No transfers</Text>
        </View>
      }
      renderItem={({ item }) => {
        const canReceive = item.status === 'DISPATCHED' || item.status === 'IN_TRANSIT';
        return (
          <TouchableOpacity
            disabled={!canReceive}
            onPress={() => router.push(`/ibt/${item.id}`)}
            style={{
              backgroundColor: colors.card, borderRadius: radius.lg,
              borderWidth: 1, borderColor: canReceive ? colors.brand + '60' : colors.border, padding: 14,
              opacity: canReceive ? 1 : 0.65,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.3 }}>{item.code}</Text>
              <Text style={{ color: tone(item.status), fontWeight: '700', fontSize: 11 }}>{item.status}</Text>
            </View>
            <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 14, marginTop: 6 }}>
              {item.fromLoc?.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <ArrowRight size={12} color={colors.brand} />
              <Text style={{ color: colors.textPrimary, fontSize: 14 }}>{item.toLoc?.name}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.lines?.length ?? 0} items</Text>
              {item.boxNumbers && <Text style={{ color: colors.textMuted, fontSize: 11 }}>📦 {item.boxNumbers}</Text>}
              {item.trackingNo && <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.trackingNo}</Text>}
            </View>
            {canReceive && (
              <Text style={{ color: colors.brand, marginTop: 10, fontWeight: '700', fontSize: 12 }}>
                Tap to receive →
              </Text>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

function tone(s: string) {
  if (s === 'RECEIVED') return colors.success;
  if (s === 'DISPATCHED' || s === 'IN_TRANSIT') return colors.warn;
  if (s === 'APPROVED') return '#38bdf8';
  return colors.textMuted;
}
