import styled from '@emotion/styled';

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  font-family: 'GilmerRegular';
`;

interface TooltipLabelProps {
  tooltip: string;
}

export function TooltipLabel(props: TooltipLabelProps) {
  const { tooltip } = props;

  return (
    <Section>
      {tooltip.split('\n').map((line, i) => (
        <Row key={i}>{line}</Row>
      ))}
    </Section>
  );
}
