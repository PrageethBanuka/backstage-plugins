import { useId } from 'react';
import { alpha, useTheme } from '@material-ui/core/styles';
import { GatewayIcon, WebAppIcon } from '@openchoreo/cell-diagram';
import type {
  RolloutPreview,
  RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';

const WIDTH = 380;
const HEIGHT = 168;
const CENTER = WIDTH / 2;
const GATEWAY_Y = 20;
const NODE_Y = 110;
const NODE_DX = 120;
const RADIUS = 20;
const FONT = 11;

/** One version in the drawing: its component, release line and colour. */
export interface FlowVersion {
  name: string;
  line?: string;
  color: string;
}

/**
 * A backend as a version in the drawing, its line named "main" when the
 * other version runs a release line of the same component.
 */
export function toFlowVersion(
  backend: { componentName: string; releaseLine?: string },
  other: { componentName: string; releaseLine?: string } | undefined,
  color: string,
): FlowVersion {
  const main =
    !backend.releaseLine &&
    other?.componentName === backend.componentName &&
    other.releaseLine;
  return {
    name: backend.componentName,
    line: backend.releaseLine ?? (main ? 'main' : undefined),
    color,
  };
}

/** The rule that reaches the new version before it gets traffic. */
export function previewRule(preview?: RolloutPreview): string {
  if (!preview) return '';
  if (preview.kind === 'cookie')
    return `cookie ${preview.name}=${preview.value}`;
  if (preview.kind === 'path') return `path ${preview.value}`;
  return `${preview.name}: ${preview.value}`;
}

/**
 * The label on the arrow to each version. Percentages only when `percent`,
 * the new version's share in one environment, is given.
 */
export function flowLabels(
  strategy: RolloutStrategy,
  preview: RolloutPreview | undefined,
  percent: number | undefined,
): { current: string; next: string; copy: boolean } {
  const rule = previewRule(preview);
  const live = percent !== undefined;
  const all = live && percent >= 100;
  switch (strategy) {
    case 'mirror':
      return {
        current: 'all requests',
        next: live ? `copy ${percent}%` : 'copy',
        copy: true,
      };
    case 'blueGreen':
      return all
        ? { current: '0%', next: 'everyone', copy: false }
        : { current: 'everyone', next: rule, copy: false };
    case 'abTest':
      return all
        ? { current: '0%', next: 'everyone', copy: false }
        : { current: 'everyone else', next: rule, copy: false };
    default:
      if (!live) return { current: 'everyone else', next: rule, copy: false };
      return {
        current: `${100 - percent}%`,
        next: [percent > 0 && `${percent}%`, rule].filter(Boolean).join(' · '),
        copy: false,
      };
  }
}

const chipWidth = (text: string) => text.length * FONT * 0.58 + 16;

function Chip({ x, y, text }: { x: number; y: number; text: string }) {
  const theme = useTheme();
  const w = chipWidth(text);
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 10}
        width={w}
        height={20}
        rx={10}
        fill={theme.palette.background.paper}
        stroke={theme.palette.divider}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={FONT}
        fill={theme.palette.text.primary}
      >
        {text}
      </text>
    </g>
  );
}

function Version({ x, version }: { x: number; version: FlowVersion }) {
  const theme = useTheme();
  const label = version.line
    ? `${version.name} · ${version.line}`
    : version.name;
  return (
    <g>
      <circle
        cx={x}
        cy={NODE_Y}
        r={RADIUS}
        fill={alpha(version.color, 0.12)}
        stroke={version.color}
        strokeWidth={2}
      />
      <foreignObject x={x - 10} y={NODE_Y - 10} width={20} height={20}>
        <WebAppIcon
          styles={{
            width: 20,
            height: 20,
            display: 'block',
            color: version.color,
          }}
        />
      </foreignObject>
      <text
        x={x}
        y={NODE_Y + RADIUS + 16}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fill={theme.palette.text.primary}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * How a rollout routes requests: the Endpoint's gateway with an arrow to
 * the current and to the new version, each labelled with its rule. The
 * versions take their colours from the traffic bar; a mirror's copy is
 * dashed.
 */
export const StrategyFlow = ({
  strategy,
  preview,
  percent,
  current,
  next,
}: {
  strategy: RolloutStrategy;
  preview?: RolloutPreview;
  /** The new version's share in one environment; omitted before it starts. */
  percent?: number;
  current: FlowVersion;
  next: FlowVersion;
}) => {
  const theme = useTheme();
  const marker = `flow-${useId().replace(/:/g, '')}`;
  const labels = flowLabels(strategy, preview, percent);
  const line = theme.palette.text.secondary;
  const arrows = [
    { dx: -1, label: labels.current, dashed: false },
    { dx: 1, label: labels.next, dashed: labels.copy },
  ];
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      style={{
        maxWidth: WIDTH,
        display: 'block',
        margin: '0 auto',
        fontFamily: theme.typography.fontFamily,
      }}
      role="img"
      aria-label={`${current.name} gets ${labels.current}; ${next.name} gets ${labels.next}`}
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="6"
          markerHeight="6"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <polygon points="0,6 0,0 6,3" fill={line} />
        </marker>
      </defs>
      {arrows.map(a => {
        const x1 = CENTER + a.dx * 10;
        const y1 = GATEWAY_Y + 12;
        const x2 = CENTER + a.dx * NODE_DX;
        const y2 = NODE_Y - RADIUS - 4;
        return (
          <g key={a.dx}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={line}
              strokeWidth={1.5}
              strokeDasharray={a.dashed ? '5,4' : undefined}
              markerEnd={`url(#${marker})`}
            />
            {a.label && (
              <Chip x={(x1 + x2) / 2} y={(y1 + y2) / 2} text={a.label} />
            )}
          </g>
        );
      })}
      <circle
        cx={CENTER}
        cy={GATEWAY_Y}
        r={14}
        fill={theme.palette.background.paper}
        stroke={line}
        strokeWidth={1.5}
      />
      <foreignObject x={CENTER - 8} y={GATEWAY_Y - 8} width={16} height={16}>
        <GatewayIcon
          styles={{ width: 16, height: 16, display: 'block', color: line }}
        />
      </foreignObject>
      <Version x={CENTER - NODE_DX} version={current} />
      <Version x={CENTER + NODE_DX} version={next} />
    </svg>
  );
};
