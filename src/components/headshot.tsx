import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors } from '@/theme';

type HeadshotProps = {
  uri: string;
  name: string;
  size: number;
};

function initials(name: string): string {
  const letters = name
    .split(/[\s.]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() ?? '');
  return `${letters[0] ?? ''}${letters.length > 1 ? (letters[letters.length - 1] ?? '') : ''}`;
}

// Headshots are decorative because the player's name is always shown beside
// them. A missing image keeps the circle and shows initials.
export function Headshot({ uri, name, size }: HeadshotProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showImage = uri !== '' && failedUri !== uri;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size * 0.82, marginTop: size * 0.18 }}
          contentFit="cover"
          contentPosition="top"
          cachePolicy="memory-disk"
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <Text style={{ fontSize: size * 0.34, fontWeight: '700', color: colors.textTertiary }}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
