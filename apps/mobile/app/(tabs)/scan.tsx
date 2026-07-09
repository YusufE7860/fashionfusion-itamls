import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { colors, radius } from '@/theme';
import { ScanLine } from 'lucide-react-native';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const router = useRouter();

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={colors.brand} />
    </View>;
  }
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
        <ScanLine color={colors.brand} size={48} />
        <Text style={{ color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 18 }}>
          Camera permission needed
        </Text>
        <Text style={{ color: colors.textMuted, marginTop: 6 }}>
          Used to scan asset QR codes for lookup, audits and dispatch confirmation.
        </Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: 18, backgroundColor: colors.brand, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function onScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    // QR encodes a URL like .../assets/:id — extract the id
    const match = data.match(/\/assets\/([\w-]+)/);
    const id = match?.[1];
    if (id) router.push(`/asset/${id}`);
    setTimeout(() => setScanned(false), 1500);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : onScan}
      />
      {/* Overlay */}
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          width: 260, height: 260, borderRadius: 18,
          borderWidth: 2, borderColor: colors.brand,
          shadowColor: colors.brand, shadowOpacity: 0.7, shadowRadius: 16,
        }} />
        <Text style={{ color: '#fff', marginTop: 18, fontSize: 13 }}>Point at an asset QR code</Text>
      </View>
    </View>
  );
}
