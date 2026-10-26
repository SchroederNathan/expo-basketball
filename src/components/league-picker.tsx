import { Host, Picker } from '@expo/ui';
import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from 'expo-router';
import { LEAGUE_IDS, LEAGUES, type League } from '@/domain/league';
import { colors } from '@/theme';

type LeaguePickerProps = {
  value: League;
  onChange: (league: League) => void;
};

export function LeaguePicker({ value, onChange }: LeaguePickerProps) {
  return (
    <Host matchContents seedColor={colors.accent}>
      <Picker selectedValue={value} onValueChange={onChange} appearance="menu">
        {LEAGUE_IDS.map((league) => (
          <Picker.Item key={league} label={LEAGUES[league].label} value={league} />
        ))}
      </Picker>
    </Host>
  );
}

// iOS shows a compact menu button beside the title. Android renders the picker
// as a Material dropdown field, which reads as the bar's title instead.
export function leagueHeaderOptions(props: LeaguePickerProps): NativeStackNavigationOptions {
  const picker = () => <LeaguePicker {...props} />;
  return Platform.OS === 'android' ? { headerTitle: picker } : { headerLeft: picker };
}
