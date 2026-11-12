import React, { useState } from 'react';
import type { ShuttleSnapshotResult } from '../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../state/editorState';
import { exportMap } from '../export/mapExporter';

interface Props {
  snapshot: ShuttleSnapshotResult;
  state: EditorState;
  onClose: () => void;
}

function downloadFile(content: Blob | string, filename: string, type: string) {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const RenderModal: React.FC<Props> = ({ snapshot, state, onClose }) => {
  const activeGrid = state.grids[state.activeGridIndex];
  const [shuttleName, setShuttleName] = useState(activeGrid?.name || 'shuttle');
  const [copied, setCopied] = useState(false);

  const handleDownloadPng = () => {
    const filename = `${shuttleName.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}-0.png`;
    downloadFile(snapshot.blob, filename, 'image/png');
  };

  const handleExportYaml = () => {
    const yaml = exportMap(
      {
        meta: state.meta,
        tilemap: state.tilemap ?? {},
        grid: state.grid,
        entities: state.entities,
        containedEntities: state.containedEntities,
        gridUid: state.gridUid,
        mapUid: state.mapUid,
        maps: state.maps,
        grids: state.gridUidList,
        gridDataList: state.grids,
        structuralEntityData: state.structuralEntityData,
        entityRawComponents: state.entityRawComponents,
        entityRawPreamble: state.entityRawPreamble,
        chunkKeyOrder: state.chunkKeyOrder,
        lineEnding: state.lineEnding,
        hasDocumentTerminator: state.hasDocumentTerminator,
        entityOrder: state.entityOrder,
      },
      state.decalsDirty,
      { exportAsGrid: true, shuttleName },
    );

    const filename = `${shuttleName.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle'}.yml`;
    downloadFile(yaml, filename, 'text/yaml');
  };

  const handleOpenInWebmap = () => {
    // Estimate size category
    let sizeCategory = 'small';
    const tileArea = snapshot.tileWidth * snapshot.tileHeight;
    if (tileArea < 100) sizeCategory = 'micro';
    else if (tileArea < 350) sizeCategory = 'small';
    else if (tileArea < 750) sizeCategory = 'medium';
    else sizeCategory = 'large';

    const customShuttleData = {
      id: 'custom',
      name: shuttleName || 'Пользовательский шаттл',
      description: `Кастомный шаттл, созданный в редакторе карт. Размер: ${snapshot.tileWidth}×${snapshot.tileHeight} тайлов, сущностей: ${snapshot.entityCount}.`,
      price: 0,
      group: 'custom',
      hullClass: 'shuttle',
      size: sizeCategory,
      classes: ['civilian'],
      engines: ['thruster'],
      image: snapshot.dataUrl,
      voucher: false,
    };

    try {
      sessionStorage.setItem('custom_preview_shuttle', JSON.stringify(customShuttleData));
      // In webmap, the shuttle viewer route is ../shuttle?id=custom
      window.open('../shuttle?id=custom', '_blank');
    } catch (e) {
      alert(`Ошибка открытия в Webmap: ${e}`);
    }
  };

  const handleCopyClipboard = async () => {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': snapshot.blob }),
        ]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        alert('Буфер обмена для изображений не поддерживается вашим браузером.');
      }
    } catch (e) {
      alert(`Не удалось скопировать изображение: ${e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-['Segoe_UI',sans-serif]">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] bg-[#0d111e] border border-[#232b42] rounded-xl shadow-2xl overflow-hidden text-[#e2e8f0]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#232b42] bg-[#131929]">
          <div className="flex items-center gap-3">
            <span className="text-xl">🚀</span>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                Рендер шаттла
              </h2>
              <span className="text-xs text-[#8da2c0]">
                Мгновенный рендер карты в формате SS14 Grid
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8da2c0] hover:text-white text-lg p-1 transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Preview Image Viewport */}
          <div className="flex-1 flex items-center justify-center p-6 bg-[#070a13] overflow-auto min-h-[300px]">
            <img
              src={snapshot.dataUrl}
              alt={shuttleName}
              className="max-h-full max-w-full object-contain rounded border border-[#1b2238] shadow-lg"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Sidebar / Settings */}
          <div className="w-full md:w-80 flex flex-col justify-between p-6 bg-[#101626] border-t md:border-t-0 md:border-l border-[#232b42] gap-4">
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[#8da2c0] uppercase tracking-wider mb-1">
                  Название шаттла:
                </label>
                <input
                  type="text"
                  value={shuttleName}
                  onChange={(e) => setShuttleName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0a0e1a] border border-[#2b3552] rounded-md text-white focus:outline-none focus:border-[#00adb5]"
                  placeholder="Название..."
                />
              </div>

              <div className="flex flex-col gap-2 p-3 bg-[#0a0e1a] rounded-lg border border-[#1e263c] text-xs">
                <div className="flex justify-between py-1 border-b border-[#1b2238]">
                  <span className="text-[#8da2c0]">Размер:</span>
                  <span className="font-mono text-white">
                    {snapshot.tileWidth} × {snapshot.tileHeight} тайлов
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1b2238]">
                  <span className="text-[#8da2c0]">Разрешение:</span>
                  <span className="font-mono text-white">
                    {snapshot.width} × {snapshot.height} px
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1b2238]">
                  <span className="text-[#8da2c0]">Сущностей:</span>
                  <span className="font-mono text-white">{snapshot.entityCount}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#8da2c0]">Формат:</span>
                  <span className="font-semibold text-[#00adb5]">SS14 Grid (.yml)</span>
                </div>
              </div>

              <p className="text-[11px] text-[#8292ab] leading-relaxed">
                Шаттл рендерится изолированно и не сохраняется в общую базу данных сайта.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={handleDownloadPng}
                className="w-full py-2.5 px-3 bg-[#00adb5] hover:bg-[#00c2cb] text-black font-semibold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <span>💾</span> Скачать PNG
              </button>

              <button
                onClick={handleExportYaml}
                className="w-full py-2.5 px-3 bg-[#1e293b] hover:bg-[#28364e] text-white font-medium text-xs rounded-lg border border-[#334155] transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <span>📄</span> Экспорт .yml (Grid)
              </button>

              <button
                onClick={handleOpenInWebmap}
                className="w-full py-2.5 px-3 bg-[#0f766e] hover:bg-[#115e59] text-white font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <span>🔭</span> Открыть в Webmap
              </button>

              <button
                onClick={handleCopyClipboard}
                className="w-full py-2 px-3 bg-transparent hover:bg-[#1a2236] text-[#8da2c0] hover:text-white text-xs rounded-lg border border-[#232b42] transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <span>📋</span> {copied ? 'Скопировано!' : 'Скопировать PNG'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
