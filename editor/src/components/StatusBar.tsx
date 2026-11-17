import React from 'react';
import type { EditorState } from '../state/editorState';
import { getCell } from '../state/editorState';

interface Props {
  state: EditorState;
  cursorTileX: number;
  cursorTileY: number;
  statusMessage: string;
}

export const StatusBar: React.FC<Props> = ({ state, cursorTileX, cursorTileY, statusMessage }) => {
  const { grid, entities } = state;
  const cell = getCell(grid, cursorTileX, cursorTileY);
  const tileId = cell ? cell.tileId : '--';

  return (
    <div className="flex items-center h-6 bg-panel border-t border-subtle px-3 text-[11px] font-mono text-muted gap-4 select-none shrink-0">
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent/80 shadow-[0_0_6px_rgba(65,182,251,0.8)]" />
        <span>Тайл:</span>
        <span className="text-primary">({cursorTileX}, {cursorTileY})</span>
      </span>
      <span className="text-primary/80 truncate max-w-[240px]" title={tileId}>{tileId}</span>
      {grid.width > 0 && (
        <span className="text-muted">
          Сетка: <span className="text-primary">{grid.width}×{grid.height}</span>
        </span>
      )}
      <span className="text-muted">
        Сущностей: <span className="text-primary">{entities.length}</span>
      </span>
      <span className="ml-auto text-accent truncate max-w-[360px]">{statusMessage}</span>
    </div>
  );
};
