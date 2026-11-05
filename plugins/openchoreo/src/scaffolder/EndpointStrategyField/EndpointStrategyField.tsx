import { useEffect, useState } from 'react';
import { Box, MenuItem, TextField, Typography } from '@material-ui/core';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  reachUnsupported,
  strategyUnsupported,
  type EndpointCapability,
  type RolloutPlan,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import { STRATEGY_COPY } from '../../components/EndpointEnvironments/progressive/endpointRolloutUi';
import {
  defaultRolloutOptions,
  RolloutOptionsFields,
  rolloutOptionsPlan,
  rolloutOptionsProblem,
  withStrategyDefaults,
  type RolloutOptions,
  type RolloutTypeSupport,
} from '../../components/EndpointEnvironments/progressive/RolloutOptionsFields';

export type EndpointStrategyChoice = 'weight' | RolloutStrategy;

/**
 * How traffic moves to the second backend, with the options Add backend
 * offers for the strategy: a canary's steps, the testers' header or path,
 * the A/B cookie group, or a mirror's copy share.
 */
export type EndpointStrategyValue = {
  strategy: EndpointStrategyChoice;
} & Partial<Pick<RolloutPlan, 'steps' | 'preview'>>;

const HOW: Record<EndpointStrategyChoice, string> = {
  weight: 'Each backend gets the share its weight gives it.',
  canary:
    'The second backend is the new version, at 0%. Step it up on the Deploy tab.',
  blueGreen:
    'The second backend is the new version, at 0%. Switch everyone on the Deploy tab.',
  abTest:
    'The second backend is the new version, for the users in the cookie group; ship it to everyone on the Deploy tab.',
  mirror:
    'The second backend is the new version. It gets a copy of requests, and nobody sees its answers.',
};

/** What the template says the Endpoint's type supports. */
function typeSupport(uiOptions: unknown): RolloutTypeSupport {
  const o = (uiOptions ?? {}) as {
    typeName?: string;
    capabilities?: EndpointCapability[];
  };
  return { typeName: o.typeName, capabilities: o.capabilities };
}

function fromValue(
  o: RolloutOptions,
  value: EndpointStrategyValue | undefined,
): RolloutOptions {
  const p = value?.preview;
  return {
    ...o,
    ...(value?.steps?.length && { steps: value.steps }),
    ...(value?.strategy === 'canary' &&
      value.steps && { useHeader: p?.kind === 'header' }),
    ...(p?.kind === 'header' && { headerName: p.name, headerValue: p.value }),
    ...(p?.kind === 'path' && { previewBy: 'path', previewPath: p.value }),
    ...(p?.kind === 'cookie' && {
      cookieName: p.name,
      cookieValue: p.value,
      audienceOn: Boolean(p.audience),
      ...(p.audience && { audience: p.audience }),
    }),
  };
}

/**
 * How traffic moves to the second backend of a new Endpoint: split by the
 * weights, or a progressive delivery strategy that starts the second backend
 * at 0%, set up as on Add backend. Shown only when the Endpoint has exactly
 * two backends.
 */
export const EndpointStrategyField = ({
  formData,
  onChange,
  formContext,
  uiSchema,
  rawErrors,
}: FieldExtensionComponentProps<EndpointStrategyValue>) => {
  const backendsField =
    (uiSchema?.['ui:options']?.backendsField as string) ?? 'backends';
  const support = typeSupport(uiSchema?.['ui:options']);
  const backends: Array<{ name?: string }> =
    formContext?.formData?.[backendsField] ?? [];
  const endpointName: string = formContext?.formData?.endpoint_name ?? '';
  const offered = backends.length === 2;
  const choice = formData?.strategy ?? 'weight';
  const strategy = choice === 'weight' ? undefined : choice;

  // Back on this step, the options start from what was chosen before.
  const [options, setOptions] = useState<RolloutOptions>(() =>
    fromValue(
      defaultRolloutOptions(strategy ?? 'canary', endpointName, support),
      formData,
    ),
  );

  useEffect(() => {
    if (!offered && choice !== 'weight') onChange({ strategy: 'weight' });
  }, [offered, choice, onChange]);

  const pick = (next: EndpointStrategyChoice, o: RolloutOptions) =>
    onChange(
      next === 'weight'
        ? { strategy: 'weight' }
        : { strategy: next, ...rolloutOptionsPlan(next, o) },
    );

  if (!offered) return null;
  const problem = strategy
    ? strategyUnsupported(strategy, support.capabilities, support.typeName) ??
      rolloutOptionsProblem(strategy, options, support)
    : '';
  return (
    <Box display="flex" flexDirection="column" gridGap={16}>
      <TextField
        select
        fullWidth
        size="small"
        variant="outlined"
        label="How traffic moves"
        value={choice}
        onChange={e => {
          const next = e.target.value as EndpointStrategyChoice;
          const o =
            next === 'weight'
              ? options
              : withStrategyDefaults(options, next, support);
          setOptions(o);
          pick(next, o);
        }}
        helperText={HOW[choice]}
        SelectProps={{
          SelectDisplayProps: { 'aria-label': 'How traffic moves' } as any,
        }}
      >
        <MenuItem value="weight">Split by weight</MenuItem>
        {(['canary', 'blueGreen', 'abTest', 'mirror'] as const).map(s => {
          const unsupported = strategyUnsupported(
            s,
            support.capabilities,
            support.typeName,
          );
          return (
            <MenuItem key={s} value={s} disabled={Boolean(unsupported)}>
              {STRATEGY_COPY[s].name}
              {unsupported && ` (${unsupported})`}
            </MenuItem>
          );
        })}
      </TextField>
      {strategy && (
        <RolloutOptionsFields
          strategy={strategy}
          value={options}
          onChange={o => {
            setOptions(o);
            pick(strategy, o);
          }}
          stableName={backends[0]?.name ?? 'the first backend'}
          support={support}
        />
      )}
      {(problem || (rawErrors?.length ?? 0) > 0) && (
        <Typography variant="caption" color="error">
          {problem || rawErrors?.[0]}
        </Typography>
      )}
    </Box>
  );
};

/**
 * Refuses a strategy whose options are incomplete or that the Endpoint's type
 * can't render, so the wizard can't go on.
 */
export const endpointStrategyFieldValidation = (
  value: EndpointStrategyValue | undefined,
  validation: { addError: (message: string) => void },
  context?: { uiSchema?: { 'ui:options'?: unknown } },
) => {
  const s = value?.strategy;
  if (!s || s === 'weight') return;
  const { capabilities, typeName } = typeSupport(
    context?.uiSchema?.['ui:options'],
  );
  const unsupported =
    strategyUnsupported(s, capabilities, typeName) ??
    reachUnsupported(
      {
        testersHeader: s === 'canary' && value.preview?.kind === 'header',
        audience: s === 'abTest' ? value.preview?.audience : undefined,
        mirrorShares: s === 'mirror' ? value.steps : undefined,
      },
      capabilities,
      typeName,
    );
  if (unsupported) {
    validation.addError(unsupported);
  } else if (s === 'canary' && !value.steps?.length) {
    validation.addError('Give the canary at least one step');
  } else if ((s === 'abTest' || s === 'blueGreen') && !value.preview) {
    validation.addError('Fill in how to reach the new backend');
  } else if (s === 'mirror' && !value.steps?.length) {
    validation.addError('Give the mirror at least one copy step');
  }
};

export const EndpointStrategyFieldSchema = {
  returnValue: {
    type: 'object' as const,
    properties: { strategy: { type: 'string' as const } },
  },
};
