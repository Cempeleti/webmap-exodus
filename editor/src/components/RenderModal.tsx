import React, { useState } from 'react';
import type { ShuttleSnapshotResult } from '../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../state/editorState';
import { exportMap } from '../export/mapExporter';
import { createShuttleShareLink } from '../services/shareService';

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
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

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
    if (shareUrl) {
      window.open(shareUrl, '_blank');
      return;
    }

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
      engines: ['plasma'],
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

  const handleShare = async () => {
    setIsSharing(true);
    setShareError(null);
    try {
      const result = await createShuttleShareLink(snapshot, state, shuttleName);
      setShareUrl(result.shareUrl);
      setShareExpiresAt(result.expiresAt);

      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(result.shareUrl);
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 3000);
        } catch {
          // ignore clipboard auto-copy denial
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setShareError(msg || 'Не удалось создать временную ссылку');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch (e) {
      alert(`Не удалось скопировать: ${e}`);
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
          <div className="w-full md:w-84 flex flex-col justify-between p-6 bg-[#101626] border-t md:border-t-0 md:border-l border-[#232b42] gap-4 overflow-y-auto max-h-[80vh]">
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

              {/* Share result card or notice */}
              {shareUrl && (
                <div className="p-3 bg-[#0a1426] border border-[#1e3e6d] rounded-lg flex flex-col gap-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#38bdf8]">
                    <span className="flex items-center gap-1.5">
                      <span>✨</span> Временная ссылка готова
                    </span>
                    <span className="text-[10px] text-[#94a3b8] font-normal">
                      3 дня
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-[#050814] border border-[#233554] rounded text-white font-mono select-all focus:outline-none"
                    />
                    <button
                      onClick={handleCopyShareLink}
                      className="px-2.5 py-1.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer"
                      title="Скопировать ссылку"
                    >
                      {shareCopied ? 'Скопировано!' : 'Копия'}
                    </button>
                    <button
                      onClick={() => window.open(shareUrl, '_blank')}
                      className="px-2 py-1.5 bg-[#1e293b] hover:bg-[#334155] text-white text-xs font-medium rounded transition-colors cursor-pointer"
                      title="Открыть в новой вкладке"
                    >
                      ↗
                    </button>
                  </div>
                  <p className="text-[10px] text-[#7d92b0] leading-snug">
                    Ссылка содержит изолированный рендер, характеристики и позволяет открыть шаттл в редакторе карт.
                  </p>
                </div>
              )}

              {shareError && (
                <div className="p-2.5 bg-red-950/60 border border-red-800/70 rounded-md text-xs text-red-200">
                  ⚠️ {shareError}
                </div>
              )}

              <p className="text-[11px] text-[#8292ab] leading-relaxed">
                Шаттл рендерится изолированно и не сохраняется в постоянную базу данных сайта.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={handleShare}
                disabled={isSharing}
                className="w-full py-2.5 px-3 bg-gradient-to-r from-[#0284c7] to-[#0ea5e9] hover:from-[#0369a1] hover:to-[#0284c7] text-white font-semibold text-xs rounded-lg shadow-md shadow-sky-950/40 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSharing ? (
                  <>
                    <span className="inline-block animate-spin">⏳</span>
                    <span>Создание ссылки...</span>
                  </>
                ) : (
                  <>
                    <span>🔗</span>
                    <span>Поделиться ссылкой (3 дня)</span>
                  </>
                )}
              </button>

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
