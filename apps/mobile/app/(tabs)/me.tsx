import { View, Text, TouchableOpacity, Image } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '@/auth';
import { colors, radius } from '@/theme';
import { LogOut } from 'lucide-react-native';

export default function MeScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const apiBase = (Constants.expoConfig?.extra as any)?.apiBaseUrl;
  const initials = user?.fullName.split(' ').map(p => p[0]).slice(0,2).join('') ?? '?';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 20 }}>
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <View style={{
          width: 84, height: 84, borderRadius: 42,
          backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
          shadowColor: colors.brand, shadowOpacity: 0.6, shadowRadius: 14,
        }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 28 }}>{initials}</Text>
        </View>
        <Text style={{ color: colors.textPrimary, fontWeight: '800', fontSize: 22, marginTop: 12 }}>
          {user?.fullName}
        </Text>
        <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12, marginTop: 4, letterSpacing: 1.4 }}>
          {user?.role.replaceAll('_',' ')}
        </Text>
      </View>

      <View style={{
        marginTop: 28, backgroundColor: colors.card,
        borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16,
      }}>
        <Row label="EMAIL" value={user?.email ?? ''} />
        <Row label="STORE" value={user?.storeId ?? '—'} />
        <Row label="API" value={apiBase} />
      </View>

      <TouchableOpacity
        onPress={logout}
        style={{
          marginTop: 24, borderRadius: radius.md,
          borderWidth: 1, borderColor: '#ef444450',
          paddingVertical: 12, alignItems: 'center',
          flexDirection: 'row', justifyContent: 'center', gap: 8,
        }}
      >
        <LogOut size={16} color={colors.danger}/>
        <Text style={{ color: colors.danger, fontWeight: '700' }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: colors.textMuted, fontSize: 10, letterSpacing: 1.4, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 13, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
