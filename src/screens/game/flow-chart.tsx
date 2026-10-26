import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { FlowChart as FlowChartData } from '@/api/schemas';
import { colors, layout, space, typography } from '@/theme';

type FlowChartProps = {
  flow: FlowChartData;
  awayLabel: string;
  homeLabel: string;
};

// The API draws the score margin in its own 354 x 64 box. Away leads plot
// above the center line and home leads below it.
export function FlowChart({ flow, awayLabel, homeLabel }: FlowChartProps) {
  const middle = flow.height / 2;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Game flow. ${awayLabel} leads plot above the line, ${homeLabel} leads below it.`}
      style={styles.container}
    >
      <Svg
        width="100%"
        height={flow.height}
        viewBox={`0 0 ${flow.width} ${flow.height}`}
        preserveAspectRatio="none"
      >
        <Path d={flow.grid} stroke={colors.hairline} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <Path d={flow.awayArea} fill={flow.awayColor} fillOpacity={0.6} />
        <Path d={flow.homeArea} fill={flow.homeColor} fillOpacity={0.6} />
        <Path
          d={`M0 ${middle} H${flow.width}`}
          stroke={colors.textMuted}
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        <Path d={flow.line} stroke={colors.text} strokeWidth={1.25} fill="none" vectorEffect="non-scaling-stroke" />
        {flow.showDot ? <Circle cx={flow.dotX} cy={flow.dotY} r={3} fill={colors.accent} /> : null}
      </Svg>
      <Text style={[typography.caption, styles.awayLabel]}>{awayLabel}</Text>
      <Text style={[typography.caption, styles.homeLabel]}>{homeLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: layout.screenPadding,
    marginTop: space.md,
  },
  awayLabel: {
    position: 'absolute',
    top: 0,
    right: 0,
    color: colors.textTertiary,
  },
  homeLabel: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    color: colors.textTertiary,
  },
});
