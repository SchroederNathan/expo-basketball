type Group = { readonly id: string; readonly name: string; readonly fullName: string };

type Table<G extends Group> = {
  readonly conferences: readonly G[];
  readonly divisions: readonly G[];
};

export type StandingsView =
  | { readonly kind: 'conference'; readonly key: string; readonly groupId: string; readonly label: string }
  | { readonly kind: 'divisions'; readonly key: 'divisions'; readonly label: string };

// Short names on the wire can be abbreviations such as "aeast" or "E", so the
// readable label comes from the full name without its group suffix.
export function groupLabel(group: Pick<Group, 'name' | 'fullName'>): string {
  const full = group.fullName.replace(/\s+(Conference|Division)$/i, '').trim();
  return full.length > 0 ? full : group.name;
}

export function standingsViews<G extends Group>(table: Table<G>): StandingsView[] {
  const views: StandingsView[] = table.conferences.map((group) => ({
    kind: 'conference',
    key: `conference:${group.id}`,
    groupId: group.id,
    label: groupLabel(group),
  }));
  if (table.divisions.length > 0) views.push({ kind: 'divisions', key: 'divisions', label: 'Divisions' });
  return views;
}

export function resolveView(views: readonly StandingsView[], key: string | null): StandingsView | null {
  return views.find((view) => view.key === key) ?? views[0] ?? null;
}

export function groupsForView<G extends Group>(table: Table<G>, view: StandingsView): readonly G[] {
  switch (view.kind) {
    case 'divisions':
      return table.divisions;
    case 'conference':
      return table.conferences.filter((group) => group.id === view.groupId);
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}
