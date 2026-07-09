import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/auth';
import { colors } from '@/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrate = useAuth((s) => s.hydrate);
  const token = useAuth((s) => s.token);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { hydrate().finally(() => setReady(true)); }, [hydrate]);

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(tabs)';
    if (!token && inAuthGroup) router.replace('/login');
    if (token && !inAuthGroup) router.replace('/(tabs)');
  }, [ready, token, segments]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.bgElev },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.bg },
      }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="asset/[id]" options={{ title: 'Asset' }} />
        <Stack.Screen name="ibt/[id]"   options={{ title: 'Receive Transfer' }} />
        <Stack.Screen name="audit/[id]" options={{ title: 'Audit' }} />
      </Stack>
    </>
  );
}
