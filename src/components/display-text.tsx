import { createContext, use, type ReactNode } from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, displaySizes, fonts } from '@/theme';

const DisplayFontContext = createContext(false);

export function DisplayFontProvider({ loaded, children }: { loaded: boolean; children: ReactNode }) {
  return <DisplayFontContext value={loaded}>{children}</DisplayFontContext>;
}

type DisplayTextProps = TextProps & {
  size: keyof typeof displaySizes;
  tone?: 'primary' | 'muted';
};

// Scores, records, and stat values use the condensed italic face. If the font
// failed to load, a heavy italic system face keeps the same emphasis.
export function DisplayText({ size, tone = 'primary', style, ...props }: DisplayTextProps) {
  const loaded = use(DisplayFontContext);
  const fontSize = displaySizes[size];
  return (
    <Text
      {...props}
      style={[
        loaded ? { fontFamily: fonts.display } : { fontWeight: '800', fontStyle: 'italic' },
        {
          fontSize,
          lineHeight: Math.round(fontSize * 1.12),
          color: tone === 'primary' ? colors.text : colors.textTertiary,
          fontVariant: ['tabular-nums'],
        },
        style,
      ]}
    />
  );
}
