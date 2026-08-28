import { useEffect, useRef, useState } from 'react';
import { FolderTree, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

const SEARCH_DEBOUNCE_MS = 200;

export interface TableToolbarProps {
  activeTab: 'trades' | 'positions';
  onTabChange: (tab: 'trades' | 'positions') => void;
  tradesCount: number;
  positionsCount: number;

  groupBy: 'strategy' | 'flat';
  onGroupByChange: (groupBy: 'strategy' | 'flat') => void;

  search: string;
  onSearchChange: (search: string) => void;
}

/**
 * Toolbar above the table.
 *
 * Uses the real Tabs and ToggleGroup primitives — both were previously
 * hand-rolled as plain <button> elements with no role, aria-selected, or
 * keyboard support, despite the primitives already sitting unused on disk.
 */
export function TableToolbar({
  activeTab,
  onTabChange,
  tradesCount,
  positionsCount,
  groupBy,
  onGroupByChange,
  search,
  onSearchChange,
}: TableToolbarProps) {
  // Local mirror so typing stays responsive; the expensive filter+regroup
  // downstream runs on a debounce rather than on every keystroke.
  const [draft, setDraft] = useState(search);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the value is changed from outside (e.g. the empty state's
  // "Clear search" action).
  useEffect(() => {
    setDraft(search);
  }, [search]);

  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => onSearchChange(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, search, onSearchChange]);

  const clearSearch = () => {
    setDraft('');
    onSearchChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2/60 p-3">
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as 'trades' | 'positions')}>
        <TabsList>
          <TabsTrigger value="trades" className="text-xs">
            Trades &amp; ROI
            <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {tradesCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs">
            Open Positions
            <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {positionsCount}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
            <FolderTree className="size-3 text-brand" aria-hidden="true" />
            Group
          </span>
          <ToggleGroup
            value={[groupBy]}
            onValueChange={(value) => {
              const next = value[0] as 'strategy' | 'flat' | undefined;
              // Base UI allows deselection; keep the control exclusive.
              if (next) onGroupByChange(next);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Group rows by"
          >
            <ToggleGroupItem value="strategy" className="text-xs">
              Strategies
            </ToggleGroupItem>
            <ToggleGroupItem value="flat" className="text-xs">
              Flat
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="relative w-56">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="search"
            aria-label="Search trades and positions by symbol or broker"
            placeholder="Search symbol, broker…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && draft) {
                event.preventDefault();
                clearSearch();
              }
            }}
            className={cn('h-9 pl-8 text-xs', draft && 'pr-8')}
          />
          {draft && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
