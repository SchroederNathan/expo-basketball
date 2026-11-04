import { useGlobalSearchParams, useIsFocused, usePathname, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notice } from '@/components/notice';
import { GameScreen } from '@/screens/game';
import { PlayerScreen } from '@/screens/player';
import { TeamScreen } from '@/screens/team';
import { colors, layout, space, typography } from '@/theme';
import { detailEntryFromPath, detailHref, detailKey, detailParams, type DetailEntry } from './hrefs';
import {
  DetailPaneContext,
  SPLIT_MIN_WIDTH,
  SplitLinksContext,
  createPaneHeaderStore,
  listPaneWidth,
  usePaneHeaderOptions,
  type PaneHeaderStore,
  type SplitLinks,
} from './split';

const PANE_HEADER_HEIGHT = 44;

// Wraps one tab's stack. Narrow windows render the stack alone, exactly as on
// a phone. Wide windows keep the stack (the list) in a left column and show
// the selected entry in a detail pane on the right. The stack stays mounted
// in the same place in the tree, so folding and unfolding keeps its state.
export function SplitView({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const split = width >= SPLIT_MIN_WIDTH;
  const [history, setHistory] = useState<readonly DetailEntry[]>([]);
  const focused = useIsFocused();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Move the open detail between the stack and the pane when the width
  // crosses the breakpoint: a detail pushed while narrow (or by a deep link)
  // moves into the pane, and the pane's history pushes onto the stack when
  // the window narrows. Only the focused tab acts, because the router targets
  // the focused stack. The pathname updates after the dismiss settles, so the
  // ref keeps a rerun in between from dismissing a second time.
  const moved = useRef<string | null>(null);
  useEffect(() => {
    if (!focused) return;
    if (split) {
      const entry = detailEntryFromPath(pathname, params);
      if (entry === null) {
        moved.current = null;
      } else if (moved.current !== pathname && router.canDismiss()) {
        moved.current = pathname;
        router.dismissAll();
        setHistory([entry]);
      }
    } else if (history.length > 0) {
      for (const entry of history) router.push(detailHref(entry));
      setHistory([]);
    }
  }, [split, focused, pathname, params, history, router]);

  const root = history[0];
  const listLinks = useMemo<SplitLinks>(
    () => ({ open: (entry) => setHistory([entry]), selectedKey: root ? detailKey(root) : null }),
    [root],
  );
  const paneLinks = useMemo<SplitLinks>(
    () => ({ open: (entry) => setHistory((current) => [...current, entry]), selectedKey: null }),
    [],
  );

  // On iOS the native stack takes the window's trailing inset (the Duo's side
  // rail, a landscape notch) even in the left column. The column reaches that
  // far under the detail pane, so its visible part keeps the full list width.
  const overlap = split && Platform.OS === 'ios' ? insets.right : 0;
  const top = history.at(-1);
  return (
    <View style={styles.row}>
      <View
        style={split ? { width: listPaneWidth(width) + overlap, marginRight: -overlap } : styles.fill}
      >
        <SplitLinksContext value={split ? listLinks : null}>{children}</SplitLinksContext>
      </View>
      {split ? (
        <View style={styles.detailPane}>
          <SplitLinksContext value={paneLinks}>
            {top ? (
              <PaneEntry
                key={detailKey(top)}
                entry={top}
                onBack={history.length > 1 ? () => setHistory((current) => current.slice(0, -1)) : null}
              />
            ) : (
              <EmptyPane />
            )}
          </SplitLinksContext>
        </View>
      ) : null}
    </View>
  );
}

function PaneEntry({ entry, onBack }: { entry: DetailEntry; onBack: (() => void) | null }) {
  const [header] = useState(createPaneHeaderStore);
  const pane = useMemo(() => ({ params: detailParams(entry), header }), [entry, header]);
  return (
    <>
      <PaneHeader store={header} onBack={onBack} />
      <HeaderHeightContext value={0}>
        <DetailPaneContext value={pane}>
          <DetailScreen entry={entry} />
        </DetailPaneContext>
      </HeaderHeightContext>
    </>
  );
}

function DetailScreen({ entry }: { entry: DetailEntry }) {
  switch (entry.kind) {
    case 'game':
      return <GameScreen />;
    case 'team':
      return <TeamScreen />;
    case 'player':
      return <PlayerScreen />;
  }
}

function PaneHeader({ store, onBack }: { store: PaneHeaderStore; onBack: (() => void) | null }) {
  const insets = useSafeAreaInsets();
  const { title, headerTitle, headerRight } = usePaneHeaderOptions(store);
  const text = title ?? '';
  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top, paddingRight: space.sm + insets.right, height: insets.top + PANE_HEADER_HEIGHT },
      ]}
    >
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={6}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.5 : 1 }]}
          >
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={20}
              weight="semibold"
              tintColor={colors.text}
            />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.title}>
        {typeof headerTitle === 'function' ? (
          headerTitle({ children: text, tintColor: colors.text })
        ) : (
          <Text numberOfLines={1} accessibilityRole="header" style={[typography.headline, styles.titleText]}>
            {typeof headerTitle === 'string' ? headerTitle : text}
          </Text>
        )}
      </View>
      <View style={[styles.side, styles.right]}>
        {headerRight?.({ tintColor: colors.text, canGoBack: onBack !== null })}
      </View>
    </View>
  );
}

function EmptyPane() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.empty, { paddingTop: insets.top }]}>
      <Notice title="Nothing selected" message="Choose a game, team, or player to see it here." />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  detailPane: {
    flex: 1,
    backgroundColor: colors.background,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.hairline,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.background,
  },
  side: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
  },
  right: {
    justifyContent: 'flex-end',
  },
  back: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
  },
});
