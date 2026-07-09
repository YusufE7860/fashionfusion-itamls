import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { colors, radius } from '@/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('tech@fashionfusion.local');
  const [password, setPassword] = useState('password');
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);

  async function submit() {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await setSession(data.accessToken, data.user);
    } catch (e: any) {
      Alert.alert('Sign in failed', e.response?.data?.message ?? 'Check email/password and API URL');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', marginBottom: 32 }}>
        <Image source={require('../assets/fusion-logo.png')}
               style={{ width: 220, height: 80, resizeMode: 'contain' }} />
        <Text style={{ color: colors.textMuted, marginTop: 10, fontSize: 12, letterSpacing: 2 }}>
          IT ASSET MANAGEMENT
        </Text>
      </View>

      <View style={{
        backgroundColor: colors.card, borderRadius: radius.lg,
        borderWidth: 1, borderColor: colors.border, padding: 20,
      }}>
        <Text style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>
          Welcome back
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 16 }}>
          Sign in to continue
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
          placeholderTextColor={colors.textMuted}
        />

        <TouchableOpacity
          onPress={submit}
          disabled={loading}
          style={{
            marginTop: 18,
            backgroundColor: colors.brand,
            borderRadius: radius.md,
            paddingVertical: 12,
            alignItems: 'center',
            shadowColor: colors.brand,
            shadowOpacity: 0.4,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          {loading
            ? <ActivityIndicator color="#fff"/>
            : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Sign in</Text>}
        </TouchableOpacity>
      </View>

      <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 18 }}>
        © Fashion Fusion · Internal use only
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = {
  label: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700' as const,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.bgElev,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
};
