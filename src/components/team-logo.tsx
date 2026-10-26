import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors } from '@/theme';

type TeamLogoProps = {
  uri: string;
  abbr: string;
  size: number;
};

// Logos are decorative because a team name or abbreviation always sits beside
// them. A missing logo keeps its box and shows the abbreviation instead.
export function TeamLogo({ uri, abbr, size }: TeamLogoProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (uri === '' || failedUri === uri) {
    return (
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: Math.max(9, size * 0.28), fontWeight: '700', color: colors.textSecondary }}
        >
          {abbr}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="memory-disk"
      accessible={false}
      onError={() => setFailedUri(uri)}
    />
  );
}
