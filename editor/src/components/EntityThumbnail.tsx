import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import type { SpriteDrawInfo } from '../loaders/rsiLoader';
import {
  getEntitySprite,
  getExtraLayers,
  getSpriteColor,
  getTintedSprite,
} from '../rendering/entityRenderer';

const THUMB_SIZE = 24;
const PREVIEW_SIZE = 128;

// Global thumbnail cache: prototypeId → dataURL (persists across re-renders/unmounts)
const thumbnailCache = new Map<string, string | null>();
// Track which prototypes are currently being polled for async sprite loading
const pendingSet = new Set<string>();

function drawThumbnailLayer(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteDrawInfo,
  size: number,
  color?: string | null,
): void {
  const hasAlpha = Boolean(color && color.length === 9);
  if (hasAlpha) {
    ctx.save();
    ctx.globalAlpha *= parseInt(color!.slice(7, 9), 16) / 255;
  }

  const tinted = color ? getTintedSprite(sprite, color) : null;
  if (tinted) {
    ctx.drawImage(tinted, 0, 0, size, size);
  } else {
    ctx.drawImage(
      sprite.image,
      sprite.sx, sprite.sy, sprite.sw, sprite.sh,
      0, 0, size, size,
    );
  }

  if (hasAlpha) {
    ctx.restore();
  }
}

/**
 * Render all visible layers of a prototype sprite into a square dataURL.
 * Returns the dataURL, null (no sprite), or undefined (still loading).
 */
function renderSpriteDataUrl(
  prototypeId: string,
  registry: IPrototypeRegistry,
  size: number,
  cacheKey: string,
  allowPartial = false,
): string | null | undefined {
  if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey)!;

  const sprite = getEntitySprite(prototypeId, 'south', registry);
  if (sprite === null) {
    thumbnailCache.set(cacheKey, null);
    return null;
  }
  const extraLayers = getExtraLayers(prototypeId, 'south', registry);
  if (sprite === undefined || (!allowPartial && extraLayers === undefined)) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    thumbnailCache.set(cacheKey, null);
    return null;
  }
  ctx.imageSmoothingEnabled = false;

  const baseColor = getSpriteColor(prototypeId, registry);
  drawThumbnailLayer(ctx, sprite, size, baseColor);

  if (extraLayers) {
    for (const layer of extraLayers) {
      drawThumbnailLayer(ctx, layer, size, layer.color);
    }
  }

  const dataUrl = canvas.toDataURL();
  if (extraLayers !== undefined) {
    thumbnailCache.set(cacheKey, dataUrl);
  }
  return dataUrl;
}

/**
 * Try to generate a thumbnail dataURL for a prototype.
 * Returns the dataURL, null (no sprite), or undefined (still loading).
 */
function getThumbnail(prototypeId: string, registry: IPrototypeRegistry): string | null | undefined {
  return renderSpriteDataUrl(prototypeId, registry, THUMB_SIZE, prototypeId);
}

/**
 * Generate a larger preview dataURL for hover popup.
 * Uses a separate cache key suffix.
 */
function getPreview(prototypeId: string, registry: IPrototypeRegistry): string | null {
  return renderSpriteDataUrl(prototypeId, registry, PREVIEW_SIZE, `${prototypeId}:preview`, true) ?? null;
}

interface EntityThumbnailProps {
  prototypeId: string;
  registry: IPrototypeRegistry;
}

/**
 * Lazy-loaded entity sprite thumbnail.
 * Uses IntersectionObserver to only load sprites when the element is visible.
 */
export const EntityThumbnail: React.FC<EntityThumbnailProps> = ({ prototypeId, registry }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => {
    // Check cache synchronously on mount
    const cached = thumbnailCache.get(prototypeId);
    return cached ?? null;
  });
  const [visible, setVisible] = useState(false);

  // IntersectionObserver: mark visible when scrolled into view
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect(); // Only need to detect first visibility
        }
      },
      { rootMargin: '100px' }, // Start loading slightly before visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Once visible, attempt to load the thumbnail
  useEffect(() => {
    if (!visible || thumbnailCache.has(prototypeId)) {
      if (thumbnailCache.has(prototypeId)) {
        setThumbUrl(thumbnailCache.get(prototypeId)!);
      }
      return;
    }

    // Poll for sprite availability (getEntitySprite triggers async load)
    if (pendingSet.has(prototypeId)) return;
    pendingSet.add(prototypeId);

    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      const result = getThumbnail(prototypeId, registry);
      if (result === undefined) {
        // Still loading, retry
        requestAnimationFrame(poll);
      } else {
        pendingSet.delete(prototypeId);
        if (!cancelled) setThumbUrl(result);
      }
    };
    poll();

    return () => { cancelled = true; pendingSet.delete(prototypeId); };
  }, [visible, prototypeId, registry]);

  const isResolvedNull = thumbnailCache.get(prototypeId) === null;

  return (
    <div ref={ref} className="w-6 h-6 shrink-0 flex items-center justify-center">
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="w-6 h-6"
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
      ) : isResolvedNull ? (
        <div
          className="w-5 h-5 rounded border border-subtle bg-surface flex items-center justify-center text-[9px] font-mono text-muted"
          title="Без видимого спрайта"
        >
          ◇
        </div>
      ) : (
        <div className="w-5 h-5 bg-surface rounded-sm animate-pulse" />
      )}
    </div>
  );
};

interface SpritePreviewPopupProps {
  prototypeId: string;
  entityName: string;
  registry: IPrototypeRegistry;
  anchorRect: DOMRect;
}

/**
 * Large sprite preview popup shown on hover.
 * Positioned to the left of the anchor element.
 */
export const SpritePreviewPopup: React.FC<SpritePreviewPopupProps> = ({
  prototypeId, entityName, registry, anchorRect,
}) => {
  const previewUrl = getPreview(prototypeId, registry);

  // Position to the left of the anchor, vertically centered
  const left = anchorRect.left - PREVIEW_SIZE - 20;
  const top = Math.max(8, anchorRect.top + anchorRect.height / 2 - (PREVIEW_SIZE + 40) / 2);

  return (
    <div
      className="fixed z-[200] bg-elevated border border-subtle rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.65)] p-2.5 pointer-events-none"
      style={{ left, top }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={entityName}
          width={PREVIEW_SIZE}
          height={PREVIEW_SIZE}
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
      ) : (
        <div
          className="bg-surface rounded flex items-center justify-center text-muted text-xs"
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
        >
          Нет спрайта
        </div>
      )}
      <div className="text-primary text-[11px] text-center mt-1 truncate" style={{ maxWidth: PREVIEW_SIZE }}>
        {entityName}
      </div>
      <div className="text-muted text-[9px] text-center truncate" style={{ maxWidth: PREVIEW_SIZE }}>
        {prototypeId}
      </div>
    </div>
  );
};

/**
 * Hook for managing hover preview state with a delay.
 */
export function useHoverPreview(delay = 300) {
  const [hovered, setHovered] = useState<{
    prototypeId: string;
    entityName: string;
    rect: DOMRect;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const currentRef = useRef<string | null>(null);

  const onMouseEnter = useCallback((prototypeId: string, entityName: string, el: HTMLElement) => {
    currentRef.current = prototypeId;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (currentRef.current === prototypeId) {
        setHovered({ prototypeId, entityName, rect: el.getBoundingClientRect() });
      }
    }, delay);
  }, [delay]);

  const onMouseLeave = useCallback(() => {
    currentRef.current = null;
    clearTimeout(timerRef.current);
    setHovered(null);
  }, []);

  return { hovered, onMouseEnter, onMouseLeave };
}
