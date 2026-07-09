import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/api';
import { colors, radius } from '@/theme';
import { ClipboardList, ChevronRight } from 'lucide-react-native';

export default function AuditsScreen() {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/audits');
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
          <ClipboardList color={colors.textMuted} size={42} />
          <Text style={{ color: colors.textMuted, marginTop: 10 }}>No audits scheduled</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={() => router.push(`/audit/${item.id}`)}
          style={{
            backgroundColor: colors.card, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.border, padding: 14,
          }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.3 }}>{item.code}</Text>
            <Text style={{ color: item.status === 'COMPLETED' ? colors.success : colors.brand, fontWeight: '700', fontSize: 11 }}>
              {item.status}
            </Text>
          </View>
          <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16, marginTop: 4 }}>
            {item.store?.code} · {item.store?.name}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {item.lines?.length ?? 0} lines · {new Date(item.scheduledFor).toLocaleDateString()}
            </Text>
            <ChevronRight size={16} color={colors.brand}/>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}
