import type { EntityContentLayoutProps } from '@backstage/plugin-catalog-react/alpha';
import { EndpointTypeOverviewCard } from '../../components/EndpointTypeOverview';
import { TypeFamilyOverviewLayout } from './TypeFamilyOverviewLayout';

export default function EndpointTypeOverviewLayout(
  props: EntityContentLayoutProps,
) {
  return (
    <TypeFamilyOverviewLayout
      OverviewCard={EndpointTypeOverviewCard}
      cards={props.cards}
    />
  );
}
