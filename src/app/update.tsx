import { useLocalSearchParams } from 'expo-router';
import { UpdateChannelScreen } from '@/screens/update';
import { parseUpdateChannel } from '@/updates/channel';

export default function UpdateRoute() {
  const params = useLocalSearchParams<{ channel?: string | string[] }>();
  return <UpdateChannelScreen channel={parseUpdateChannel(params.channel)} />;
}
