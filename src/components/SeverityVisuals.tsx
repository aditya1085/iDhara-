import React from 'react';
import {
  DataProvenance,
  FloodSeverity,
  ProductMode,
  RoadStatus,
} from '../types/idhara';

export const SEVERITY_META: Record<
  FloodSeverity,
  {
    label: string;
    shortCode: string;
    glyph: string;
    patternId: string;
    textColor: string;
    borderColor: string;
    bgTint: string;
    svgFill: string;
    svgStroke: string;
    patternDescription: string;
  }
> = {
  [FloodSeverity.CRITICAL]: {
    label: 'CRITICAL',
    shortCode: 'CRIT',
    glyph: '✖',
    patternId: 'url(#pattern-critical-crosshatch)',
    textColor: 'text-rose-400',
    borderColor: 'border-rose-500/60',
    bgTint: 'bg-rose-950/40',
    svgFill: 'rgba(239, 68, 68, 0.34)',
    svgStroke: '#EF4444',
    patternDescription: 'Crosshatch + ✖ Critical',
  },
  [FloodSeverity.HIGH]: {
    label: 'HIGH',
    shortCode: 'HIGH',
    glyph: '▲',
    patternId: 'url(#pattern-high-diagonal)',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/60',
    bgTint: 'bg-amber-950/40',
    svgFill: 'rgba(249, 115, 22, 0.28)',
    svgStroke: '#F97316',
    patternDescription: 'Diagonal Stripe + ▲ High',
  },
  [FloodSeverity.MODERATE]: {
    label: 'MODERATE',
    shortCode: 'MOD',
    glyph: '◆',
    patternId: 'url(#pattern-moderate-dots)',
    textColor: 'text-yellow-300',
    borderColor: 'border-yellow-500/50',
    bgTint: 'bg-yellow-950/30',
    svgFill: 'rgba(234, 179, 8, 0.20)',
    svgStroke: '#EAB308',
    patternDescription: 'Stipple Dots + ◆ Moderate',
  },
  [FloodSeverity.LOW]: {
    label: 'LOW',
    shortCode: 'LOW',
    glyph: '●',
    patternId: 'none',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/40',
    bgTint: 'bg-emerald-950/25',
    svgFill: 'rgba(16, 185, 129, 0.09)',
    svgStroke: '#10B981',
    patternDescription: 'Solid Clear + ● Low',
  },
};

export const ROAD_STATUS_META: Record<
  RoadStatus,
  {
    label: string;
    glyph: string;
    textColor: string;
    strokeColor: string;
    dashArray: string;
  }
> = {
  [RoadStatus.CLOSED_INUNDATED]: {
    label: 'CLOSED · INUNDATED',
    glyph: '✖',
    textColor: 'text-rose-400',
    strokeColor: '#EF4444',
    dashArray: '4 4',
  },
  [RoadStatus.RESTRICTED_SHALLOW]: {
    label: 'RESTRICTED · HIGH-CLEARANCE ONLY',
    glyph: '▲',
    textColor: 'text-amber-400',
    strokeColor: '#F97316',
    dashArray: '8 4',
  },
  [RoadStatus.CAUTION_WATERLOGGING]: {
    label: 'CAUTION · CURB WATERLOGGING',
    glyph: '◆',
    textColor: 'text-yellow-300',
    strokeColor: '#EAB308',
    dashArray: 'none',
  },
  [RoadStatus.OPEN]: {
    label: 'OPEN · PASSABLE',
    glyph: '●',
    textColor: 'text-emerald-400',
    strokeColor: '#10B981',
    dashArray: 'none',
  },
};

export const MODE_META: Record<
  ProductMode,
  {
    label: string;
    shortDesc: string;
    accentText: string;
    borderClass: string;
    bgClass: string;
    indicatorSymbol: string;
  }
> = {
  [ProductMode.SIMULATED]: {
    label: 'SIMULATED',
    shortDesc: 'Synthetic Hydrological-Terrain Proxy Scenario',
    accentText: 'text-cyan-300',
    borderClass: 'border-cyan-500/60',
    bgClass: 'bg-cyan-950/40',
    indicatorSymbol: '◈',
  },
  [ProductMode.HISTORICAL]: {
    label: 'HISTORICAL',
    shortDesc: 'Archived Indore Cloudburst Replay',
    accentText: 'text-amber-300',
    borderClass: 'border-amber-500/60',
    bgClass: 'bg-amber-950/40',
    indicatorSymbol: '◷',
  },
  [ProductMode.MOCK]: {
    label: 'MOCK',
    shortDesc: 'Deterministic Stress Benchmark Payload',
    accentText: 'text-purple-300',
    borderClass: 'border-purple-500/60',
    bgClass: 'bg-purple-950/40',
    indicatorSymbol: '▣',
  },
  [ProductMode.LIVE]: {
    label: 'LIVE',
    shortDesc: 'Pilot Telemetry Ingestion Loop (Synthetic Indore Feed)',
    accentText: 'text-emerald-300',
    borderClass: 'border-emerald-500/60',
    bgClass: 'bg-emerald-950/40',
    indicatorSymbol: '◉',
  },
};

export const SeverityIndicator: React.FC<{
  severity: FloodSeverity;
  showPatternNote?: boolean;
}> = ({ severity, showPatternNote = false }) => {
  const meta = SEVERITY_META[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${meta.textColor}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
      {showPatternNote && (
        <span className="text-slate-400 font-normal">({meta.patternDescription})</span>
      )}
    </span>
  );
};

export const RoadStateIndicator: React.FC<{ state: RoadStatus }> = ({ state }) => {
  const meta = ROAD_STATUS_META[state];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${meta.textColor}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
    </span>
  );
};

/**
 * Displays mandatory iDhara provenance metadata contract:
 * mode · scope_id · generated_at · data_as_of · confidence
 * Uses clean unboxed text with typographic separators (no static pill clutter).
 */
export const ProvenanceStrip: React.FC<{
  provenance: DataProvenance;
  expiry?: string;
  compact?: boolean;
}> = ({ provenance, expiry, compact = false }) => {
  const modeMeta = MODE_META[provenance.mode];
  const genTime = provenance.generated_at.slice(11, 19) + 'Z';
  const asOfTime = provenance.data_as_of.slice(11, 19) + 'Z';
  const expTime = expiry ? expiry.slice(11, 19) + 'Z' : null;
  const confPct = Math.round(provenance.confidence * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums border-t border-slate-800/80 pt-2 mt-2">
      <span className={`font-semibold ${modeMeta.accentText}`}>
        {modeMeta.indicatorSymbol} MODE: {provenance.mode}
      </span>
      <span aria-hidden="true">·</span>
      <span>SCOPE: {provenance.scope_id}</span>
      <span aria-hidden="true">·</span>
      <span className="text-slate-300">CONF: {confPct}%</span>
      {!compact && (
        <>
          <span aria-hidden="true">·</span>
          <span>GEN: {genTime}</span>
          <span aria-hidden="true">·</span>
          <span>AS_OF: {asOfTime}</span>
        </>
      )}
      {expTime && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-amber-300">EXP: {expTime}</span>
        </>
      )}
    </div>
  );
};
