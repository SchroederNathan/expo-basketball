import { Host, Picker } from '@expo/ui';
import { Stack, type NativeStackNavigationOptions } from 'expo-router';
import { Platform } from 'react-native';
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

// Android renders the picker as a Material dropdown field, which reads as the
// bar's title. iOS uses LeagueToolbar instead.
export function leagueHeaderOptions(props: LeaguePickerProps): NativeStackNavigationOptions {
  return Platform.OS === 'android' ? { headerTitle: () => <LeaguePicker {...props} /> } : {};
}

// A native menu item, unlike a custom header view, moves into the iPhone Duo's
// rail. The label names the item in VoiceOver and the overflow menu.
export function LeagueToolbar({ value, onChange }: LeaguePickerProps) {
  if (Platform.OS !== 'ios') return null;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Menu icon="basketball" accessibilityLabel={`League, ${LEAGUES[value].label}`}>
        <Stack.Toolbar.Label>{LEAGUES[value].label}</Stack.Toolbar.Label>
        {LEAGUE_IDS.map((league) => (
          <Stack.Toolbar.MenuAction key={league} isOn={league === value} onPress={() => onChange(league)}>
            {LEAGUES[league].label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
