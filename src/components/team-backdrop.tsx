import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { beamStops } from '@/domain/game';
import { colors } from '@/theme';

type Backdrop =
  | { readonly kind: 'matchup'; readonly away: string; readonly home: string }
  | { readonly kind: 'team'; readonly color: string };

const BEAM_LOCATIONS = [0, 0.18, 0.42] as const;

// A still backdrop of team-color light. It fades into the page at the bottom,
// so the content below it needs no separator.
export function TeamBackdrop({ backdrop, top = 0 }: { backdrop: Backdrop; top?: number }) {
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, { top }]}
    >
      {backdrop.kind === 'matchup' ? (
        <>
          <LinearGradient
            colors={beamStops(backdrop.away)}
            locations={BEAM_LOCATIONS}
            start={{ x: 0, y: 0.3 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={beamStops(backdrop.home)}
            locations={BEAM_LOCATIONS}
            start={{ x: 1, y: 0.3 }}
            end={{ x: 0, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient
          colors={beamStops(backdrop.color)}
          locations={BEAM_LOCATIONS}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <LinearGradient
        colors={[colors.backgroundClear, colors.background]}
        locations={[0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
