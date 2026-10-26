import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { parseYmd, type Ymd } from '@/domain/dates';
import type { League } from '@/domain/league';
import { gameHref, scoresHref } from '@/navigation/hrefs';
import { setPreferredLeague } from '@/state/preferences';
import { parsePushDestination, type PushDestination } from './model';
import { acknowledgeOpen } from './service';

type Router = ReturnType<typeof useRouter>;

const OPEN_ACK_TIMEOUT_MS = 3000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const handled = new Set<string>();

function payloadOf(response: Notifications.NotificationResponse): unknown {
  const { request } = response.notification;
  const trigger = request.trigger;
  // Remote notifications keep custom keys in the trigger payload, next to "aps".
  if (trigger !== null && 'type' in trigger && trigger.type === 'push' && trigger.payload) return trigger.payload;
  return request.content.data;
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([task, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

function openScores(router: Router, league: League, date: Ymd | null): void {
  setPreferredLeague(league);
  router.dismissTo(scoresHref({ league, date }));
}

async function open(destination: PushDestination, router: Router): Promise<void> {
  const { deliveryId } = destination;
  if (destination.kind === 'game') {
    router.push(gameHref(destination.game));
    if (deliveryId !== null) void acknowledgeOpen(deliveryId);
    return;
  }
  if (destination.date !== null || deliveryId === null) {
    openScores(router, destination.league, destination.date);
    if (deliveryId !== null) void acknowledgeOpen(deliveryId);
    return;
  }
  // Recap pushes name no date. The service's record of the delivery has it.
  const opened = await withTimeout(acknowledgeOpen(deliveryId), OPEN_ACK_TIMEOUT_MS);
  openScores(router, destination.league, parseYmd(opened?.date));
}

// Opens the screen a tapped push points to, including the push that launched
// the app. Each response is handled once.
export function PushResponseBridge() {
  const response = Notifications.useLastNotificationResponse();
  const router = useRouter();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = response.notification.request.identifier;
    if (handled.has(key)) return;
    handled.add(key);
    Notifications.clearLastNotificationResponse();
    const destination = parsePushDestination(payloadOf(response));
    if (destination !== null) void open(destination, router);
  }, [response, router]);
  return null;
}
