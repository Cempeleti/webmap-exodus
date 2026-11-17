import React, { useRef, useState, useEffect, useCallback } from 'react';

interface Props {
  onNewMap: () => void;
  onImport: (content: string) => void;
  onExport: () => void;
  onExportShuttle?: () => void;
  onExportStation?: () => void;
  onRenderShuttle?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  showGrid: boolean;
  onToggleGrid: () => void;
  showEntities: boolean;
  onToggleEntities: () => void;
  showSpaceBackground: boolean;
  onToggleSpaceBackground: () => void;
  showLighting: boolean;
  onToggleLighting: () => void;
  showPerfHUD: boolean;
  onTogglePerfHUD: () => void;
  showBenchmark: boolean;
  onToggleBenchmark: () => void;
  showShortcuts: boolean;
  onShowShortcuts: () => void;
  onCloseShortcuts: () => void;
  forkName?: string;
  onSwitchFork?: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

const MenuDropdown: React.FC<{
  label: string;
  items: MenuItem[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  hoverOpen: boolean;
  onHoverOpen: () => void;
}> = ({ label, items, isOpen, onOpen, onClose, hoverOpen, onHoverOpen }) => {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="relative">
      <button
        className={`px-3 py-1 text-xs text-primary cursor-pointer hover:bg-hover rounded-sm border-none h-full ${
          isOpen ? 'bg-active' : 'bg-transparent'
        }`}
        onClick={() => isOpen ? onClose() : onOpen()}
        onMouseEnter={() => { if (hoverOpen) onHoverOpen(); }}
      >
        {label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 min-w-[200px] bg-elevated border border-subtle rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.65)] z-50 py-1">
          {items.map((item, i) => {
            if (item.separator) {
              return <div key={i} className="h-px bg-subtle mx-2 my-1" />;
            }
            return (
              <button
                key={i}
                disabled={item.disabled}
                onClick={() => {
                  item.action?.();
                  onClose();
                }}
                className={`flex w-full px-3 py-1.5 text-xs text-left items-center gap-2 border-none bg-transparent transition-colors ${
                  item.disabled
                    ? 'text-muted opacity-50 cursor-default hover:bg-transparent'
                    : 'text-primary cursor-pointer hover:bg-hover'
                }`}
              >
                <span className="w-[16px] text-center text-[11px] text-accent">
                  {item.checked !== undefined ? (item.checked ? '\u2713' : '') : ''}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-muted font-mono ml-4 text-[10px]">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MenuBar: React.FC<Props> = ({
  onNewMap, onImport, onExport, onExportShuttle, onExportStation, onRenderShuttle, onUndo, onRedo, canUndo, canRedo, dirty,
  showGrid, onToggleGrid, showEntities, onToggleEntities,
  showSpaceBackground, onToggleSpaceBackground,
  showLighting, onToggleLighting,
  showPerfHUD, onTogglePerfHUD,
  showBenchmark, onToggleBenchmark,
  showShortcuts, onShowShortcuts, onCloseShortcuts,
  forkName, onSwitchFork,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showForkMenu, setShowForkMenu] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const forkMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Close fork menu when clicking outside
  useEffect(() => {
    if (!showForkMenu) return;
    const handler = (e: MouseEvent) => {
      if (forkMenuRef.current && !forkMenuRef.current.contains(e.target as Node)) {
        setShowForkMenu(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showForkMenu]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onImport);
    e.target.value = '';
  };

  const handleNewMap = () => {
    if (dirty && !window.confirm('Несохранённые изменения будут потеряны. Продолжить?')) return;
    onNewMap();
  };

  const openMenuFn = useCallback((name: string) => setOpenMenu(name), []);
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const fileItems: MenuItem[] = [
    { label: 'Новый шаттл / карта', shortcut: 'Ctrl+N', action: handleNewMap },
    { label: 'separator', separator: true },
    { label: 'Импорт .yml...', shortcut: 'Ctrl+O', action: handleImportClick },
    { label: 'Экспорт шаттла (.yml Grid)', shortcut: 'Ctrl+S', action: onExportShuttle ?? onExport },
    { label: 'Экспорт станции (.yml Map)', action: onExportStation ?? onExport },
    { label: 'separator', separator: true },
    { label: 'Рендер в галерею...', shortcut: 'Ctrl+R', action: onRenderShuttle },
  ];

  const editItems: MenuItem[] = [
    { label: 'Отменить', shortcut: 'Ctrl+Z', action: onUndo, disabled: !canUndo },
    { label: 'Повторить', shortcut: 'Ctrl+Y', action: onRedo, disabled: !canRedo },
  ];

  const viewItems: MenuItem[] = [
    { label: 'Сетка тайлов', action: onToggleGrid, checked: showGrid },
    { label: 'Сущности', action: onToggleEntities, checked: showEntities },
    { label: 'Фон космоса', action: onToggleSpaceBackground, checked: showSpaceBackground },
    { label: 'Предпросмотр освещения', action: onToggleLighting, checked: showLighting },
    { label: 'separator', separator: true },
    { label: 'Монитор FPS (HUD)', action: onTogglePerfHUD, checked: showPerfHUD },
    { label: 'Бенчмарк', action: onToggleBenchmark, checked: showBenchmark },
    { label: 'separator', separator: true },
    { label: 'Горячие клавиши', shortcut: '?', action: onShowShortcuts },
  ];

  const menus: { name: string; items: MenuItem[] }[] = [
    { name: 'Файл', items: fileItems },
    { name: 'Правка', items: editItems },
    { name: 'Вид', items: viewItems },
  ];

  return (
    <div ref={barRef} className="flex items-center h-10 bg-panel border-b border-subtle px-2.5 gap-1.5 select-none shrink-0">
      <a
        href="../"
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-white bg-surface/80 hover:bg-hover border border-subtle rounded transition-colors no-underline mr-1"
        title="Вернуться в каталог Webmap"
      >
        <span className="text-accent">←</span>
        <span className="font-medium">Каталог</span>
      </a>

      <span
        className="text-[13px] font-bold tracking-[0.06em] uppercase text-accent mr-1.5 hidden sm:inline"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        EXODUS MAPPER
      </span>

      <div className="h-4 w-px bg-subtle mx-0.5 hidden sm:block" />

      {menus.map(menu => (
        <MenuDropdown
          key={menu.name}
          label={menu.name}
          items={menu.items}
          isOpen={openMenu === menu.name}
          onOpen={() => openMenuFn(menu.name)}
          onClose={closeMenu}
          hoverOpen={openMenu !== null}
          onHoverOpen={() => openMenuFn(menu.name)}
        />
      ))}

      <div className="flex items-center gap-0.5 ml-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Отменить (Ctrl+Z)"
          className={`px-2 py-1 text-xs rounded border border-transparent transition-colors ${
            canUndo
              ? 'text-primary hover:bg-hover hover:border-subtle cursor-pointer bg-transparent'
              : 'text-muted/40 cursor-default bg-transparent'
          }`}
        >
          ↶
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Повторить (Ctrl+Y)"
          className={`px-2 py-1 text-xs rounded border border-transparent transition-colors ${
            canRedo
              ? 'text-primary hover:bg-hover hover:border-subtle cursor-pointer bg-transparent'
              : 'text-muted/40 cursor-default bg-transparent'
          }`}
        >
          ↷
        </button>
      </div>

      {onRenderShuttle && (
        <button
          onClick={onRenderShuttle}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-accent/15 hover:bg-accent/25 text-accent border border-accent/45 rounded cursor-pointer transition-all shadow-[0_0_14px_rgba(65,182,251,0.16)] ml-1.5"
          title="Сделать рендер шаттла и опубликовать в галерею"
        >
          <span>🚀</span>
          <span>Рендер</span>
        </button>
      )}

      {forkName && (
        <div className="relative ml-1.5" ref={forkMenuRef}>
          <button
            onClick={() => setShowForkMenu(!showForkMenu)}
            className="flex items-center gap-1.5 text-[11px] text-muted hover:text-primary cursor-pointer bg-surface/90 border border-subtle rounded px-2.5 py-1 transition-colors"
            title="Активный билд игры (нажмите для выбора папки)"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(63,185,80,0.85)]" />
            <span className="font-mono text-accent">{forkName}</span>
          </button>
          {showForkMenu && (
            <div className="absolute left-0 top-full mt-1 bg-elevated border border-subtle rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.65)] z-50 py-1 min-w-[210px]">
              <a
                href="https://github.com/SerbiaStrong-220/Monolith"
                target="_blank"
                rel="noreferrer"
                className="block px-3 py-1.5 text-[11px] text-muted hover:text-white hover:bg-hover no-underline"
              >
                GitHub: SerbiaStrong-220/Monolith ↗
              </a>
              <button
                onClick={() => { setShowForkMenu(false); onSwitchFork?.(); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-primary hover:bg-hover cursor-pointer bg-transparent border-none border-t border-subtle"
              >
                Указать локальную папку билда...
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {dirty && (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-warning/15 border border-warning/35 text-warning text-[10px] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
          Не сохранено
        </span>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {showShortcuts && <ShortcutsModal onClose={onCloseShortcuts} />}
    </div>
  );
};

/* ── Shortcuts Modal ─────────────────────────────────────── */

const SHORTCUT_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Инструменты',
    rows: [
      ['B', 'Кисть (тайлы)'],
      ['E', 'Ластик'],
      ['I', 'Пипетка'],
      ['H', 'Рука (панорамирование)'],
      ['G', 'Заливка'],
      ['R', 'Прямоугольник'],
      ['L', 'Линия'],
      ['C', 'Круг'],
      ['S', 'Выделение (тайлы + объекты)'],
      ['V', 'Выбор сущностей'],
      ['P', 'Размещение сущностей'],
      ['K', 'Прокладка кабелей'],
      ['J', 'Прокладка труб'],
      ['D', 'Связывание устройств'],
    ],
  },
  {
    title: 'Общее',
    rows: [
      ['Ctrl+Z', 'Отменить'],
      ['Ctrl+Y / Ctrl+Shift+Z', 'Повторить'],
      ['Ctrl+N', 'Новая карта / шаттл'],
      ['Ctrl+O', 'Импорт .yml'],
      ['Ctrl+S', 'Экспорт .yml'],
      ['Ctrl+R', 'Рендер шаттла'],
      ['Ctrl+F', 'Поиск сущностей на карте'],
      ['Space (удерж.)', 'Панорамирование'],
      ['Escape', 'Снять выделение / закрыть окно'],
      ['?', 'Эта справка'],
    ],
  },
  {
    title: 'Буфер обмена (Выделение)',
    rows: [
      ['Ctrl+C', 'Копировать'],
      ['Ctrl+X', 'Вырезать'],
      ['Ctrl+V', 'Вставить'],
      ['Delete / Backspace', 'Удалить выделенное'],
    ],
  },
  {
    title: 'Поворот объектов',
    rows: [
      ['R', 'По часовой (90\u00b0)'],
      ['Shift+R', 'Против часовой (90\u00b0)'],
    ],
  },
  {
    title: 'Мышь',
    rows: [
      ['Колёсико', 'Масштаб'],
      ['СКМ + тянуть', 'Панорамирование'],
      ['ЛКМ + тянуть', 'Применить инструмент'],
      ['Shift + клик', 'Свободное размещение / мультивыбор'],
      ['Shift + тянуть', 'Точный сдвиг сущности (дробные коорд.)'],
      ['ПКМ', 'Снять выделение / контекстное меню / стереть'],
      ['Колёсико на стопке', 'Перебор перекрытых сущностей'],
    ],
  },
];

const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(5,8,16,0.78)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-elevated border border-subtle rounded-lg p-6 max-w-[560px] w-full max-h-[80vh] overflow-y-auto text-primary text-[13px] shadow-[0_18px_48px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-accent m-0 uppercase tracking-wider" style={{ fontFamily: 'var(--font-display)' }}>Управление</h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {SHORTCUT_SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted mb-1.5 font-semibold">
              {section.title}
            </h3>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {section.rows.map(([key, desc]) => (
                <React.Fragment key={key + desc}>
                  <kbd className="text-accent font-mono text-[12px] text-right whitespace-nowrap">{key}</kbd>
                  <span className="text-primary">{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}

        <div className="text-center mt-4">
          <button
            onClick={onClose}
            className="bg-active border border-subtle rounded text-primary text-[13px] px-6 py-2 cursor-pointer hover:bg-hover transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
