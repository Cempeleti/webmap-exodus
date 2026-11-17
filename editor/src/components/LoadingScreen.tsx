import React from 'react';
import { RepositoryLink } from './RepositoryLink';

interface Props {
  message: string;
}

export const LoadingScreen: React.FC<Props> = ({ message }) => {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center bg-panel text-primary gap-5 z-[1000]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 42%, rgba(65, 182, 251, 0.12) 0%, rgba(5, 8, 16, 0) 58%), linear-gradient(rgba(65, 182, 251, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(65, 182, 251, 0.03) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 36px 36px, 36px 36px',
      }}
    >
      <div className="flex flex-col items-center gap-1.5">
        <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-muted">
          Monolith / Exodus Resource Core
        </div>
        <div className="text-3xl font-bold tracking-[0.12em] uppercase text-accent drop-shadow-[0_0_16px_rgba(65,182,251,0.35)]" style={{ fontFamily: 'var(--font-display)' }}>
          EXODUS WEBMAPPING
        </div>
      </div>

      <div className="w-[320px] h-1.5 bg-surface border border-subtle rounded-full overflow-hidden shadow-inner">
        <div className="h-full bg-gradient-to-r from-accent/40 via-accent to-[#82d3ff] rounded-full animate-[loading-pulse_1.4s_ease-in-out_infinite] w-[42%]" />
      </div>

      <div className="text-[12px] font-mono text-muted tracking-wide">
        {message}
      </div>

      <RepositoryLink className="absolute bottom-4 right-5" />

      <style>{`
        @keyframes loading-pulse {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
};
