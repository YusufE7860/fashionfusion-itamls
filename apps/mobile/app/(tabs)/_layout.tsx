import { Tabs } from 'expo-router';
import { Home, ScanLine, ClipboardList, User, Truck } from 'lucide-react-native';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.bgElev,
          borderTopColor: colors.border,
          height: 64,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.bgElev },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Tabs.Screen name="index"     options={{ title: 'Home',      tabBarIcon: ({ color }) => <Home size={20} color={color} /> }} />
      <Tabs.Screen name="scan"      options={{ title: 'Scan',      tabBarIcon: ({ color }) => <ScanLine size={20} color={color} /> }} />
      <Tabs.Screen name="transfers" options={{ title: 'Transfers', tabBarIcon: ({ color }) => <Truck size={20} color={color} /> }} />
      <Tabs.Screen name="audits"    options={{ title: 'Audits',    tabBarIcon: ({ color }) => <ClipboardList size={20} color={color} /> }} />
      <Tabs.Screen name="me"        options={{ title: 'Me',        tabBarIcon: ({ color }) => <User size={20} color={color} /> }} />
    </Tabs>
  );
}
