import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { StrategyGroup, UnderlyingGroup } from '../../utils/tastyParser';
import type { ColumnDef, DataTableProps, SortState } from './types';

const HIDE_BELOW_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

/**
 * One table for every view.
 *
 * Replaces four near-duplicate hand-written <table> blocks (~690 lines) that
 * repeated the same <th> markup 32 times. Beyond deduplication this adds three
 * things none of the originals had: sortable columns, keyboard-reachable rows,
 * and a real loading skeleton.
 *
 * Depth is carried by the elevation scale — underlying rows rise to surface-2,
 * strategy rows sit at surface-1, leaf rows recede to surface-0 — so nesting
 * reads as physical depth rather than as indentation alone.
 */
export function DataTable<Row extends { id: string }>({
  columns,
  rows,
  groups,
  collapse,
  selectedId,
  onSelect,
  loading = false,
  empty,
  skeletonRows = 8,
  caption,
  className,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState | null>(null);

  const isGrouped = Array.isArray(groups);

  const sortedRows = useMemo(() => {
    if (isGrouped || !rows) return rows ?? [];
    if (!sort) return rows;

    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);

      // Nullish always sorts last, regardless of direction.
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;

      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, groups, isGrouped, sort, columns]);

  const toggleSort = (column: ColumnDef<Row>) => {
    if (!column.sortable || !column.sortValue) return;
    setSort((prev) => {
      if (prev?.columnId !== column.id) return { columnId: column.id, direction: 'desc' };
      if (prev.direction === 'desc') return { columnId: column.id, direction: 'asc' };
      return null; // third click clears the sort
    });
  };

  const colCount = columns.length;
  const hasContent = isGrouped ? (groups?.length ?? 0) > 0 : sortedRows.length > 0;

  return (
    <div className={cn('relative w-full overflow-auto custom-scrollbar', className)}>
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>

        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>

        <thead className="sticky top-0 z-20 bg-surface-2">
          <tr>
            {columns.map((column) => {
              const isSorted = sort?.columnId === column.id;
              const canSort = Boolean(column.sortable && column.sortValue);

              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    !canSort
                      ? undefined
                      : isSorted
                        ? sort!.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                  }
                  className={cn(
                    'border-b border-border bg-surface-2 p-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
                    column.align === 'end' && 'text-right',
                    column.sticky && 'sticky left-0 z-30',
                    column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow]
                  )}
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className={cn(
                        'group inline-flex items-center gap-1 rounded uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer',
                        column.align === 'end' && 'flex-row-reverse',
                        isSorted && 'text-foreground'
                      )}
                    >
                      <span>{column.header}</span>
                      {isSorted ? (
                        sort!.direction === 'asc' ? (
                          <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown
                          className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-border/40">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'p-3',
                      column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow]
                    )}
                  >
                    <Skeleton className={cn('h-3.5', column.align === 'end' ? 'ml-auto w-16' : 'w-24')} />
                  </td>
                ))}
              </tr>
            ))
          ) : !hasContent ? (
            <tr>
              <td colSpan={colCount} className="p-0">
                {empty}
              </td>
            </tr>
          ) : isGrouped ? (
            groups!.map((uGroup) => (
              <UnderlyingRows
                key={uGroup.key}
                uGroup={uGroup}
                columns={columns}
                collapse={collapse}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))
          ) : (
            sortedRows.map((row) => (
              <LeafRow
                key={row.id}
                row={row}
                columns={columns}
                depth={0}
                selected={selectedId === row.id}
                onSelect={onSelect}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UnderlyingRows<Row extends { id: string }>({
  uGroup,
  columns,
  collapse,
  selectedId,
  onSelect,
}: {
  uGroup: UnderlyingGroup<Row>;
  columns: ColumnDef<Row>[];
  collapse?: DataTableProps<Row>['collapse'];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const isCollapsed = Boolean(collapse?.underlyings[uGroup.key]);

  return (
    <Fragment>
      <GroupRow
        level="underlying"
        expanded={!isCollapsed}
        onToggle={() => collapse?.toggleUnderlying(uGroup.key)}
        label={uGroup.symbol}
        columns={columns}
        renderCell={(column) => column.underlyingCell?.(uGroup)}
      />

      {!isCollapsed &&
        uGroup.strategies.map((strategy) => (
          <StrategyRows
            key={strategy.id}
            strategy={strategy}
            columns={columns}
            collapse={collapse}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </Fragment>
  );
}

function StrategyRows<Row extends { id: string }>({
  strategy,
  columns,
  collapse,
  selectedId,
  onSelect,
}: {
  strategy: StrategyGroup<Row>;
  columns: ColumnDef<Row>[];
  collapse?: DataTableProps<Row>['collapse'];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const isCollapsed = Boolean(collapse?.strategies[strategy.id]);
  const containsSelection = strategy.items.some((item) => item.id === selectedId);

  return (
    <Fragment>
      <GroupRow
        level="strategy"
        expanded={!isCollapsed}
        onToggle={() => collapse?.toggleStrategy(strategy.id)}
        label={strategy.strategyName}
        highlighted={containsSelection}
        columns={columns}
        renderCell={(column) => column.strategyCell?.(strategy)}
      />

      {!isCollapsed &&
        strategy.items.map((item) => (
          <LeafRow
            key={item.id}
            row={item}
            columns={columns}
            depth={2}
            selected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
    </Fragment>
  );
}

function GroupRow<Row extends { id: string }>({
  level,
  expanded,
  onToggle,
  label,
  highlighted = false,
  columns,
  renderCell,
}: {
  level: 'underlying' | 'strategy';
  expanded: boolean;
  onToggle: () => void;
  label: string;
  highlighted?: boolean;
  columns: ColumnDef<Row>[];
  renderCell: (column: ColumnDef<Row>) => ReactNode;
}) {
  const isUnderlying = level === 'underlying';

  return (
    <tr
      className={cn(
        'transition-colors',
        isUnderlying
          ? 'border-t border-border bg-surface-2 hover:bg-surface-3'
          : 'bg-card hover:bg-surface-2',
        !isUnderlying && 'border-l-2 border-l-strategy/50',
        highlighted && !isUnderlying && 'bg-brand/8'
      )}
    >
      {columns.map((column, index) => (
        <td
          key={column.id}
          className={cn(
            'bg-inherit p-3',
            column.align === 'end' && 'text-right',
            column.sticky && 'sticky left-0 z-10',
            column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow]
          )}
        >
          {index === 0 ? (
            <div className={cn('flex items-center gap-2', !isUnderlying && 'pl-4')}>
              {/* A real button, not a styled span — this is the disclosure control. */}
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
                className="shrink-0 rounded text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer"
              >
                {expanded ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
              </button>
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  isUnderlying ? 'bg-brand' : 'bg-strategy'
                )}
                aria-hidden="true"
              />
              {renderCell(column)}
            </div>
          ) : (
            renderCell(column)
          )}
        </td>
      ))}
    </tr>
  );
}

function LeafRow<Row extends { id: string }>({
  row,
  columns,
  depth,
  selected,
  onSelect,
}: {
  row: Row;
  columns: ColumnDef<Row>[];
  depth: number;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const interactive = Boolean(onSelect);

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect!(row.id);
    }
  };

  return (
    <tr
      // Composed through cn() so tailwind-merge resolves the background
      // conflict. Built as a raw template string, the selected background lost
      // to CSS source order and the highlight never rendered.
      className={cn(
        'border-b border-border/40 transition-colors',
        depth > 0 ? 'bg-surface-0' : 'bg-card',
        interactive && 'cursor-pointer hover:bg-surface-2',
        depth > 0 && 'border-l-2 border-l-border',
        selected && 'bg-brand/15 border-l-brand',
        interactive &&
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
      )}
      onClick={interactive ? () => onSelect!(row.id) : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={interactive ? 0 : undefined}
      aria-selected={interactive ? selected : undefined}
      role={interactive ? 'row' : undefined}
    >
      {columns.map((column, index) => (
        <td
          key={column.id}
          className={cn(
            'bg-inherit p-3',
            column.align === 'end' && 'text-right',
            column.sticky && 'sticky left-0 z-10',
            column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow]
          )}
        >
          {index === 0 && depth > 0 ? (
            <div className="pl-10">{column.cell(row)}</div>
          ) : (
            column.cell(row)
          )}
        </td>
      ))}
    </tr>
  );
}
