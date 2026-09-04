import type { ReactNode } from 'react';

import type { StrategyGroup, UnderlyingGroup } from '../../utils/tastyParser';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface ColumnDef<Row> {
  id: string;
  header: string;
  align?: 'start' | 'end';
  /** Applied to the <col> element, e.g. '140px'. */
  width?: string;
  /** Hide the column below this breakpoint so narrow viewports stay readable. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Pin the column while the table scrolls horizontally. Intended for the
   * first (symbol) column — without it, an 8-column table scrolls the row's
   * identity out of view.
   */
  sticky?: boolean;

  sortable?: boolean;
  /** Value used for ordering. Return null/undefined to sort last. */
  sortValue?: (row: Row) => number | string | null | undefined;
  /** Value used for ordering strategy groups in grouped view. Return null/undefined to sort last. */
  sortStrategy?: (group: StrategyGroup<Row>, direction: SortDirection) => number | string | null | undefined;
  /** Value used for ordering underlying groups in grouped view. Return null/undefined to sort last. */
  sortUnderlying?: (group: UnderlyingGroup<Row>, direction: SortDirection) => number | string | null | undefined;

  /** Leaf row renderer. */
  cell: (row: Row) => ReactNode;
  /** Renderer for the underlying (top) group row. Falls back to blank. */
  underlyingCell?: (group: UnderlyingGroup<Row>) => ReactNode;
  /** Renderer for the strategy (middle) group row. Falls back to blank. */
  strategyCell?: (group: StrategyGroup<Row>) => ReactNode;
}

/**
 * Collapse state is owned by the caller so it survives tab switches and
 * regrouping — the same behaviour the hand-written tables had.
 */
export interface GroupCollapseState {
  underlyings: Record<string, boolean>;
  strategies: Record<string, boolean>;
  toggleUnderlying: (key: string) => void;
  toggleStrategy: (id: string) => void;
}

export interface DataTableProps<Row extends { id: string }> {
  columns: ColumnDef<Row>[];

  /** Flat mode: pass rows. Grouped mode: pass groups. */
  rows?: Row[];
  groups?: UnderlyingGroup<Row>[];
  collapse?: GroupCollapseState;

  selectedId?: string | null;
  onSelect?: (id: string) => void;

  loading?: boolean;
  /** Shown when there is nothing to render and `loading` is false. */
  empty?: ReactNode;
  /** Rows of skeleton to draw while loading. */
  skeletonRows?: number;

  /** Accessible name for the table. */
  caption: string;
  className?: string;
}
