import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { TeamBackdrop } from '@/components/team-backdrop';
import { useReducedMotion } from '@/state/reduced-motion';
import { colors } from '@/theme';
import { CURTAIN_HEIGHT, CURTAIN_TOP, VISIBLE_BOTTOM, type Palette } from './model';
import { CurtainSurfaceView } from './surface';

export function GameCurtain({ palette, active, contentOriginY, scrollY }: Readonly<{
  palette: Palette | null;
  active: boolean;
  contentOriginY: number;
  scrollY: SharedValue<number>;
}>) {
  const reduced = useReducedMotion();
  const { scale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [pageVisible, setPageVisible] = useState(true);
  const [retained, setRetained] = useState(palette);
  if (palette && (palette.away !== retained?.away || palette.home !== retained?.home)) setRetained(palette);
  const reveal = useSharedValue(0);
  const onReady = useCallback(() => {
    reveal.set(withTiming(1, { duration: 800, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.Never }));
  }, [reveal]);
  const onUnavailable = useCallback(() => reveal.set(0), [reveal]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    if (Platform.OS !== 'web') return () => subscription.remove();
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      subscription.remove();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useAnimatedReaction(
    () => contentOriginY + VISIBLE_BOTTOM - Math.max(0, scrollY.get()) > 0,
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(setInView, visible);
    },
    [contentOriginY],
  );
  const position = useAnimatedStyle(() => ({
    transform: [{ translateY: contentOriginY + CURTAIN_TOP - Math.max(0, scrollY.get()) }],
  }));
  const opacity = useAnimatedStyle(() => ({ opacity: reveal.get() }));
  const visible = active && foreground && pageVisible && inView;

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.viewport}>
      <Animated.View style={[styles.fabric, position]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {retained ? <TeamBackdrop backdrop={{ kind: 'matchup', ...retained }} /> : null}
        <Animated.View style={[StyleSheet.absoluteFill, opacity]}>
          <CurtainSurfaceView
            input={{ palette, animate: visible && !reduced, visible, width, height: CURTAIN_HEIGHT, pixelRatio: scale }}
            onReady={onReady}
            onUnavailable={onUnavailable}
          />
          <LinearGradient colors={[colors.backgroundClear, colors.background]} locations={[0, 0.6]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  fabric: { position: 'absolute', top: 0, left: 0, right: 0, height: CURTAIN_HEIGHT },
});
