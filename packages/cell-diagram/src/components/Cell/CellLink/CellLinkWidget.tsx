import { MouseEvent, useContext, useEffect, useMemo, useState } from 'react';
import {
  DiagramEngine,
  PortModelAlignment,
} from '@projectstorm/react-diagrams';
import { CellLinkModel } from './CellLinkModel';
import {
  CELL_LINK,
  LABEL_FONT_SIZE,
  LINK_WIDTH,
  WarningIcon,
} from '../../../resources';
import { ObservationLabel } from '../../ObservationLabel/ObservationLabel';
import { TooltipLabel } from '../../TooltipLabel/TooltipLabel';
import { DiagramContext } from '../../DiagramContext/DiagramContext';
import { DiagramLayer, RolloutStrategy } from '../../../types';
import { SharedLink } from '../../SharedLink/SharedLink';
import Popper from '@mui/material/Popper';
import Box from '@mui/material/Box';
import { CellBounds } from '../CellNode/CellModel';
import { useColors } from '../../../theme';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';

interface WidgetProps {
  engine: DiagramEngine;
  link: CellLinkModel;
}

export function CellLinkWidget(props: WidgetProps) {
  const { link } = props;
  const colors = useColors();

  const tooltipPopOverStyle = useMemo(
    () => ({
      backgroundColor: colors.SURFACE,
      border: `1px solid ${colors.SECONDARY}`,
      padding: '10px',
      borderRadius: '5px',
      display: 'flex',
      flexDirection: 'column' as const,
      maxWidth: '280px',
      gap: '8px',
      pointerEvents: 'none' as const,
    }),
    [colors],
  );

  const observabilityPopOverStyle = useMemo(
    () => ({
      backgroundColor: colors.SURFACE,
      border: `1px solid ${colors.SECONDARY}`,
      padding: '10px',
      borderRadius: '5px',
      display: 'flex',
      flexDirection: 'column' as const,
      pointerEvents: 'none' as const,
    }),
    [colors],
  );

  const {
    diagramLayers: { hasLayer },
    observationSummary: { requestCount: { min, max } } = {
      requestCount: { min: 0, max: 0 },
    },
    previewMode,
  } = useContext(DiagramContext);

  const [isSelected, setIsSelected] = useState<boolean>(false);
  const [anchorEl, setAnchorEl] = useState<null | SVGGElement>(null);

  const open =
    (link.tooltip || link.observations?.length > 0) &&
    Boolean(anchorEl) &&
    !previewMode;
  const hasArchitectureLayer = hasLayer(DiagramLayer.ARCHITECTURE);
  const hasObservabilityLayer = hasLayer(DiagramLayer.OBSERVABILITY);
  const hasDiffLayer = hasLayer(DiagramLayer.DIFF);

  const hideLink =
    (hasObservabilityLayer &&
      (!link.observations || link.observations?.length === 0) &&
      !hasArchitectureLayer &&
      !hasDiffLayer) ||
    (hasArchitectureLayer &&
      !hasObservabilityLayer &&
      !hasDiffLayer &&
      link.observationOnly) ||
    (previewMode && link.observationOnly);
  // A rollout's links are marked in the architecture view: current solid,
  // new dashed (dotted for a mirror's copies) with a chip naming it.
  const marked =
    link.rollouts.length > 0 &&
    hasArchitectureLayer &&
    !hasDiffLayer &&
    !hideLink &&
    !previewMode;
  const newIn = [...link.rollouts]
    .filter(r => r.role === 'new')
    .sort(
      (a, b) =>
        Number(a.strategy === 'mirror') - Number(b.strategy === 'mirror'),
    );
  const [peerHighlight, setPeerHighlight] = useState(false);
  useEffect(() => link.onRolloutHighlight(setPeerHighlight), [link]);

  useEffect(() => {
    const listener = link.registerListener({
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      SELECT: selectPath,
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      UNSELECT: unselectPath,
    });
    return () => {
      link.deregisterListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, hideLink]);

  useEffect(() => {
    if (link.getIsExternalConsumerLink()) {
      const destinationNode = link.getDestinationNode();
      if (destinationNode) {
        destinationNode.fireEvent(
          {
            cellBound:
              link.getTargetPort().getOptions().alignment ===
              PortModelAlignment.TOP
                ? CellBounds.NorthBound
                : CellBounds.WestBound,
          },
          isSelected
            ? 'EXTERNAL_CONSUMER_LINK_SELECT'
            : 'EXTERNAL_CONSUMER_LINK_UNSELECT',
        );
      }
    }
  }, [link, isSelected]);

  const selectPath = () => {
    if (hideLink) {
      return;
    }
    setIsSelected(true);
    link.selectLinkedNodes();
  };

  const unselectPath = () => {
    setIsSelected(false);
    link.resetLinkedNodes();
  };

  const handleMouseOver = (
    event: MouseEvent<SVGGElement, globalThis.MouseEvent>,
  ) => {
    event.stopPropagation();
    if (hideLink || previewMode) {
      return;
    }
    selectPath();
    setAnchorEl(event.currentTarget);
    if (marked) {
      link.highlightRolloutPeers(true);
    }
  };

  const handleMouseLeave = (
    event: MouseEvent<SVGGElement, globalThis.MouseEvent>,
  ) => {
    event.stopPropagation();
    if (previewMode) {
      return;
    }
    unselectPath();
    setAnchorEl(null);
    link.highlightRolloutPeers(false);
  };

  const getRequestCount = () => {
    if (
      !hasObservabilityLayer ||
      !link.observations ||
      link.observations.length === 0
    ) {
      return 0;
    }
    return link.observations?.reduce((acc, obs) => acc + obs.requestCount, 0);
  };

  const strokeWidth = () => {
    if (previewMode) {
      return LINK_WIDTH.PREVIEW;
    }
    const requestCount = getRequestCount();
    return requestCount
      ? link.scaleValueToLinkWidth(requestCount, min, max)
      : LINK_WIDTH.DEFAULT;
  };

  const strokeColor = () => {
    if (
      (isSelected || (marked && peerHighlight)) &&
      (hasArchitectureLayer || hasDiffLayer)
    ) {
      return colors.SECONDARY;
    }
    if (hasDiffLayer && link.observationOnly) {
      return colors.ERROR;
    }
    if (hasObservabilityLayer && link.observations?.length > 0) {
      return colors.PRIMARY;
    }
    if (hideLink) {
      return 'transparent';
    }
    if (marked) {
      return colors.PRIMARY;
    }

    return colors.OUTLINE;
  };

  const strokeDash = () => {
    if (hasDiffLayer && !(link.observations?.length > 0)) {
      return '8,8';
    }
    if (marked && newIn.length > 0) {
      return newIn.every(r => r.strategy === 'mirror') ? '2,4' : '6,4';
    }
    return '';
  };

  const midPoint = link.getMidPoint();
  // The rollout chip sits by the component rather than in the bundle of
  // links leaving the gateway.
  const endPoint = link.getLastPoint()?.getPosition() ?? midPoint;
  const chipPoint = {
    x: midPoint.x + (endPoint.x - midPoint.x) * 0.6,
    y: midPoint.y + (endPoint.y - midPoint.y) * 0.6,
  };

  return (
    <>
      <g
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        pointerEvents="all"
        className={CELL_LINK}
      >
        <defs>
          <marker
            id={link.getLinkArrowId()}
            markerWidth="8"
            markerHeight="8"
            markerUnits="strokeWidth"
            refX="4"
            refY="3"
            viewBox="0 0 6 6"
            orient="auto"
          >
            <polygon points="0,6 0,0 5,3" fill={strokeColor()} />
          </marker>
        </defs>
        <path
          d={link.getCurvePath()}
          fill="none"
          stroke="transparent"
          strokeWidth={40}
        />
        <SharedLink.Path
          selected={hasObservabilityLayer && isSelected}
          id={link.getID()}
          d={link.getCurvePath()}
          fill="none"
          stroke={strokeColor()}
          strokeWidth={strokeWidth()}
          strokeDasharray={strokeDash()}
          markerEnd={
            link.showArrowHead() && !hasObservabilityLayer
              ? `url(#${link.getLinkArrowId()})`
              : ''
          }
        />
        {marked && newIn.length > 0 && (
          <RolloutChip
            x={chipPoint.x}
            y={chipPoint.y}
            strategy={newIn[0].strategy}
            text={
              newIn.length > 1
                ? `${newIn[0].endpoint} +${newIn.length - 1}`
                : newIn[0].endpoint
            }
            fill={colors.PRIMARY_CONTAINER}
            color={colors.PRIMARY}
          />
        )}
        {hasDiffLayer && link.observationOnly && !previewMode && (
          <WarningIcon
            x={midPoint.x - 10}
            y={midPoint.y - 10}
            width="20"
            height="20"
          />
        )}
      </g>
      {(hasObservabilityLayer || link.tooltip) && !previewMode && (
        <Popper id={link.getID()} open={Boolean(open)} anchorEl={anchorEl}>
          <Box
            sx={
              link.observations?.length > 0 && !link.tooltip
                ? observabilityPopOverStyle
                : tooltipPopOverStyle
            }
          >
            {link.tooltip && <TooltipLabel tooltip={link.tooltip} />}
            {link.observations?.length > 0 && (
              <ObservationLabel observations={link.observations} />
            )}
          </Box>
        </Popper>
      )}
    </>
  );
}

const CHIP_FONT_SIZE = LABEL_FONT_SIZE * 0.7;

const STRATEGY_ICONS: Record<RolloutStrategy, typeof CallSplitIcon> = {
  canary: CallSplitIcon,
  blueGreen: SwapHorizIcon,
  abTest: GroupWorkIcon,
  mirror: FileCopyOutlinedIcon,
};

/**
 * Marks the link to a rollout's new version: the strategy's icon and the
 * Endpoint, drawn like a component's release-line badge.
 */
function RolloutChip(props: {
  x: number;
  y: number;
  strategy: RolloutStrategy;
  text: string;
  fill: string;
  color: string;
}) {
  const { x, y, strategy, text, fill, color } = props;
  const Icon = STRATEGY_ICONS[strategy];
  const height = CHIP_FONT_SIZE * 1.6;
  const icon = CHIP_FONT_SIZE;
  const gap = 4;
  const textWidth = text.length * CHIP_FONT_SIZE * 0.6;
  const width = icon + gap + textWidth + 16;
  const left = x - width / 2;
  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={y - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={fill}
        stroke={color}
      />
      <Icon
        x={left + 8}
        y={y - icon / 2}
        width={icon}
        height={icon}
        htmlColor={color}
        style={{ fontSize: icon }}
      />
      <text
        x={left + 8 + icon + gap}
        y={y}
        dominantBaseline="central"
        fontSize={CHIP_FONT_SIZE}
        fill={color}
      >
        {text}
      </text>
    </g>
  );
}
