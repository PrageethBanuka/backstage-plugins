import { PortModelAlignment } from '@projectstorm/react-diagrams';
import { Point } from '@projectstorm/geometry';
import { SharedLinkModel } from '../../SharedLink/SharedLink';
import { CellBounds } from '../CellNode/CellModel';
import { getEmptyNodeName } from '../cell-util';
import { ComponentModel } from '../../Component/ComponentNode/ComponentModel';
import { RolloutMark } from '../../../types';

interface LinkOrigins {
  nodeId: string;
}

export class CellLinkModel extends SharedLinkModel {
  sourceNode!: LinkOrigins;
  targetNode!: LinkOrigins;
  isExternalConsumerLink!: boolean;
  destinationNode!: ComponentModel;
  rollouts: RolloutMark[] = [];
  /** The other links of the rollouts this link takes part in. */
  rolloutPeers: CellLinkModel[] = [];

  constructor(id: string) {
    super(id, 'cellLink');
  }

  setIsExternalConsumerLink(isExternalConsumerLink: boolean) {
    this.isExternalConsumerLink = isExternalConsumerLink;
  }

  setDestinationNode(destinationNode: ComponentModel) {
    this.destinationNode = destinationNode;
  }

  setRollouts(rollouts: RolloutMark[]) {
    this.rollouts = rollouts;
  }

  setRolloutPeers(peers: CellLinkModel[]) {
    this.rolloutPeers = peers;
  }

  private rolloutHighlightListeners = new Set<(on: boolean) => void>();

  /** Calls listener when a peer of this link is hovered or left. */
  onRolloutHighlight(listener: (on: boolean) => void): () => void {
    this.rolloutHighlightListeners.add(listener);
    return () => {
      this.rolloutHighlightListeners.delete(listener);
    };
  }

  /** Highlights this link's rollout peers, or clears them. */
  highlightRolloutPeers(on: boolean) {
    for (const peer of this.rolloutPeers) {
      peer.rolloutHighlightListeners.forEach(listener => listener(on));
    }
  }

  setSourceNode(nodeId: string) {
    this.sourceNode = { nodeId };
  }

  setTargetNode(nodeId: string) {
    this.targetNode = { nodeId };
  }

  getDestinationNode() {
    return this.destinationNode;
  }

  getIsExternalConsumerLink() {
    return this.isExternalConsumerLink;
  }

  getArrowHeadPoints = (scale = 1): string => {
    let points = '';
    const sizeMultiplier = Math.max(Math.min(scale / 9, 4), 1);
    const targetPort: Point = this.getTargetPort().getPosition();

    if (
      this.getTargetPort().getOptions().alignment === PortModelAlignment.LEFT &&
      getEmptyNodeName(CellBounds.WestBound) === this.sourceNode.nodeId
    ) {
      points = `${targetPort.x} ${targetPort.y}, ${
        targetPort.x - 14 * sizeMultiplier
      } ${targetPort.y + 10 * sizeMultiplier},
                ${targetPort.x - 14 * sizeMultiplier} ${
        targetPort.y - 10 * sizeMultiplier
      }`;
    } else if (
      this.getTargetPort().getOptions().alignment === PortModelAlignment.TOP &&
      getEmptyNodeName(CellBounds.NorthBound) === this.sourceNode.nodeId
    ) {
      points = `${targetPort.x} ${targetPort.y}, ${
        targetPort.x + 10 * sizeMultiplier
      } ${targetPort.y - 15 * sizeMultiplier},
                ${targetPort.x - 10 * sizeMultiplier} ${
        targetPort.y - 15 * sizeMultiplier
      }`;
    }
    return points;
  };

  showArrowHead = (): boolean => {
    const targetPortAlignment = this.getTargetPort().getOptions().alignment;
    const sourceNodeId = this.sourceNode.nodeId;

    if (
      targetPortAlignment === PortModelAlignment.LEFT &&
      getEmptyNodeName(CellBounds.WestBound) === sourceNodeId
    ) {
      return true;
    }

    if (
      targetPortAlignment === PortModelAlignment.TOP &&
      getEmptyNodeName(CellBounds.NorthBound) === sourceNodeId
    ) {
      return true;
    }

    return false;
  };
}
