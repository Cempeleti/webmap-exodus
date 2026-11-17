import React from 'react';
import type { GridData } from '../state/gridData';
import { EntitySearchBar } from './EntitySearchBar';
import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from '../loaders/registryTypes';

interface Props {
  grids: GridData[];
  activeGridIndex: number;
  onSelectGrid: (index: number) => void;
  onAddGrid: () => void;
  onDeleteGrid: (gridUid: number) => void;
  onRenameGrid: (gridUid: number, newName: string) => void;
  onFocusGrid: (index: number) => void;
  entities: ImportedEntity[];
  registry: IPrototypeRegistry | null;
  onSearchNavigate: (entity: ImportedEntity) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onValidate?: () => void;
}

export const GridTabBar: React.FC<Props> = ({
  grids, activeGridIndex, onSelectGrid, onAddGrid, onDeleteGrid, onRenameGrid, onFocusGrid,
  entities, registry, onSearchNavigate, searchInputRef, onValidate,
}) => {
  return (
    <div className="flex items-end bg-panel border-b border-subtle shrink-0">
      <div className="flex items-end overflow-x-auto min-w-0">
        {grids.map((gd, idx) => {
          const isActive = idx === activeGridIndex;
          return (
            <div
              key={gd.gridUid}
              data-active={isActive ? 'true' : 'false'}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer select-none border-r border-subtle whitespace-nowrap
                ${isActive
                  ? 'bg-surface text-primary border-b-2 border-b-accent'
                  : 'bg-panel text-muted hover:text-primary hover:bg-hover'
                }`}
              onClick={() => onSelectGrid(idx)}
              onDoubleClick={() => {
                const name = prompt('Переименовать сетку:', gd.name);
                if (name && name !== gd.name) onRenameGrid(gd.gridUid, name);
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && grids.length > 1) {
                  e.preventDefault();
                  onDeleteGrid(gd.gridUid);
                }
              }}
            >
              <span>{gd.name}</span>
              <span className="text-muted font-mono text-[10px]">({gd.gridUid})</span>
              {grids.length > 1 && (
                <button
                  className="ml-1 text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Закрыть сетку"
                  onClick={(e) => { e.stopPropagation(); onDeleteGrid(gd.gridUid); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="px-2.5 py-1.5 text-xs text-muted hover:text-accent hover:bg-hover transition-colors"
          title="Добавить новую сетку (грид)"
          onClick={onAddGrid}
        >
          +
        </button>
      </div>

      <div className="flex-1" />

      <button
        onClick={onValidate}
        className="flex items-center gap-1.5 self-center text-warning bg-warning/15 hover:bg-warning/25 border border-warning/40 cursor-pointer rounded text-[11px] font-medium px-2.5 py-1 mr-2 shrink-0 transition-colors"
        title="Проверить карту на ошибки"
      >
        <span className="text-[11px]">&#x26A0;</span>
        <span>Проверить</span>
      </button>

      <div className="pr-2 py-0.5 shrink-0">
        <EntitySearchBar
          entities={entities}
          registry={registry}
          onNavigate={onSearchNavigate}
          searchInputRef={searchInputRef}
        />
      </div>
    </div>
  );
};
