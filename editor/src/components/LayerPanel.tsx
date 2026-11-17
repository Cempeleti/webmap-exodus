import React from 'react';
import type { LayerVisibility } from '../rendering/entityRenderer';

interface Props {
  layers: LayerVisibility;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  showSubFloor: boolean;
  onToggleSubFloor: () => void;
  showConnections: boolean;
  onToggleConnections: () => void;
}

const LAYER_DEFS: { key: keyof LayerVisibility; label: string; desc: string }[] = [
  { key: 'subfloor', label: 'Подпол (SubFloor)', desc: 'Кабели, трубы, пневмопочта (-22.. -13)' },
  { key: 'floorObjects', label: 'Напольные', desc: 'Ковры, напольные предметы (-12.. -5)' },
  { key: 'structures', label: 'Конструкции', desc: 'Стены, окна, решётки (-2.. -1)' },
  { key: 'objects', label: 'Объекты', desc: 'Мебель, станки, настенное (0.. +7)' },
  { key: 'doors', label: 'Шлюзы и двери', desc: 'Шлюзы, фаерлоки, бласт-двери (+8.. +10)' },
  { key: 'markers', label: 'Маркеры', desc: 'Точки спавна, вспомогательные маркеры' },
  { key: 'decals', label: 'Декали', desc: 'Разметка пола, стрелки, потёртости' },
];

export const LayerPanel: React.FC<Props> = ({
  layers, onToggleLayer, showSubFloor, onToggleSubFloor,
  showConnections, onToggleConnections,
}) => {
  return (
    <div className="px-3 py-2">
      {LAYER_DEFS.map(def => (
        <label key={def.key} className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none hover:text-white transition-colors" title={def.desc}>
          <input
            type="checkbox"
            checked={layers[def.key]}
            onChange={() => onToggleLayer(def.key)}
            className="accent-accent w-3.5 h-3.5"
          />
          {def.label}
        </label>
      ))}

      <div className="h-px bg-subtle my-2" />

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none hover:text-white transition-colors" title="Показывать скрытую инфраструктуру под плиткой (режим T-Ray)">
        <input
          type="checkbox"
          checked={showSubFloor}
          onChange={onToggleSubFloor}
          className="accent-accent w-3.5 h-3.5"
        />
        T-Ray (под полом)
      </label>

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none hover:text-white transition-colors" title="Показывать логические связи устройств">
        <input
          type="checkbox"
          checked={showConnections}
          onChange={onToggleConnections}
          className="accent-accent w-3.5 h-3.5"
        />
        Связи устройств
      </label>
    </div>
  );
};
