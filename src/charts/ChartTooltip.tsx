import { Chip } from '../components/ui/Chip';
import { Tooltip } from '../components/ui/Tooltip';
import type { Bounds } from '../components/ui/tooltipPlacement';
import { VERDICT_LABEL } from '../components/ui/verdict';
import { DisplayName } from '../util/DisplayName';
import { formatDelta, formatValue } from '../views/overview/model';
import { runColor, type ChartTokens } from './colors';
import { runMarker } from './markers';
import type { ChartData, ChartEntry } from './data';
import { MarkerIcon } from './MarkerIcon';

/**
 * Hover/focus tooltip of a chart mark (spec Phase 5b "Tooltip content"): experiment name, then one
 * line per series — swatch, label, value, Δ chip. HTML, so names go through <DisplayName>.
 */
export function ChartTooltip({
  anchor,
  data,
  entry,
  tokens,
  showBaseline = true,
  onDismiss,
}: {
  anchor: Bounds;
  data: ChartData;
  entry: ChartEntry;
  tokens: ChartTokens;
  showBaseline?: boolean;
  onDismiss(): void;
}) {
  const metric = data.metric;
  if (!metric) return null;
  return (
    <Tooltip anchor={anchor} onDismiss={onDismiss} className="min-w-[220px]">
      <DisplayName value={entry.name} className="block font-mono text-[12px] font-semibold" />
      <table className="mt-1.5 w-full border-collapse font-mono text-[11px]">
        <tbody>
          {showBaseline && (
            <tr>
              <td className="py-0.5 pr-3">
                <span className="flex items-center gap-1.5">
                  <MarkerIcon color={runColor(tokens, -1)} shape="square" />
                  <span>baseline</span>
                </span>
              </td>
              <td className="pr-2 text-right">{formatValue(entry.base, metric)}</td>
              <td />
            </tr>
          )}
          {data.runs.map((s) => {
            const p = entry.points[s.id];
            return (
              <tr key={s.id}>
                <td className="max-w-[160px] py-0.5 pr-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MarkerIcon
                      color={runColor(tokens, s.colorIndex)}
                      shape={runMarker(s.colorIndex)}
                    />
                    <DisplayName value={s.label} />
                  </span>
                </td>
                <td className="pr-2 text-right">
                  {p && p.verdict !== 'missing' ? formatValue(p.value, metric) : '—'}
                </td>
                <td className="text-right">
                  {p && (
                    <Chip
                      variant="diff"
                      verdict={p.verdict}
                      title={`Δ ${VERDICT_LABEL[p.verdict]}`}
                    >
                      {p.verdict === 'missing' ? '' : formatDelta(p.delta, metric)}
                    </Chip>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-faint">Click to open in Table</p>
    </Tooltip>
  );
}
