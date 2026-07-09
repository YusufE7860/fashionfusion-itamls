import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import SignatureCanvas from 'react-native-signature-canvas';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api';
import { colors, radius } from '@/theme';
import { Check } from 'lucide-react-native';

export default function ReceiveIbtScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [ibt, setIbt] = useState<any>(null);
  const [signedBy, setSignedBy] = useState('');
  const [signing, setSigning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sigRef = useRef<any>(null);

  useEffect(() => {
    if (!id) return;
    api.get('/ibt').then(({ data }) => setIbt(data.find((x: any) => x.id === id))).catch(() => {});
  }, [id]);

  function submit(signature: string) {
    setSubmitting(true);
    api.post(`/ibt/${id}/receive`, { signedBy, signatureDataUrl: signature })
      .then(() => { Alert.alert('Received', 'Transfer marked as received.'); router.back(); })
      .catch((e) => Alert.alert('Failed', e.response?.data?.message ?? 'Receive failed'))
      .finally(() => setSubmitting(false));
  }

  if (!ibt) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color={colors.brand}/></View>;

  // Signature canvas WebView style (white pen on dark bg)
  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; background: #0f1626; }
    .m-signature-pad--body { border: none; }
    .m-signature-pad--footer { display: none; }
    body, html { background: #0f1626; margin: 0; }
    canvas { background: #0f1626; }
  `;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1.3 }}>{ibt.code}</Text>
        <Text style={{ color: colors.textPrimary, fontWeight: '800', fontSize: 18, marginTop: 4 }}>
          From {ibt.fromLoc?.name}
        </Text>
        <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
          To {ibt.toLoc?.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
          {ibt.lines?.length ?? 0} items{ibt.boxNumbers ? ` · 📦 ${ibt.boxNumbers}` : ''}{ibt.trackingNo ? ` · ${ibt.trackingNo}` : ''}
        </Text>
      </View>

      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 18, marginBottom: 6 }}>
        PRINT NAME
      </Text>
      <TextInput
        value={signedBy} onChangeText={setSignedBy}
        placeholder="e.g. Lerato Khumalo" placeholderTextColor={colors.textMuted}
        style={{
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
          color: colors.textPrimary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm,
        }}
      />

      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 18, marginBottom: 6 }}>
        SIGNATURE
      </Text>
      <View style={{ height: 220, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        <SignatureCanvas
          ref={sigRef}
          onOK={submit}
          onEmpty={() => Alert.alert('Sign first', 'Please draw a signature before confirming.')}
          descriptionText=""
          webStyle={webStyle}
          penColor="#ffffff"
          backgroundColor="#0f1626"
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <TouchableOpacity
          onPress={() => sigRef.current?.clearSignature()}
          style={{
            flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
            paddingVertical: 12, alignItems: 'center',
          }}>
          <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!signedBy || submitting}
          onPress={() => { setSigning(true); sigRef.current?.readSignature(); setSigning(false); }}
          style={{
            flex: 2, backgroundColor: colors.brand, borderRadius: radius.md,
            paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
            opacity: !signedBy || submitting ? 0.5 : 1,
          }}>
          {submitting ? <ActivityIndicator color="#fff"/> : <>
            <Check size={16} color="#fff"/>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Confirm receipt</Text>
          </>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
