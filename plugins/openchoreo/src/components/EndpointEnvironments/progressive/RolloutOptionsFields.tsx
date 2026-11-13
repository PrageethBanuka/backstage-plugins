import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@material-ui/core';
import { alpha, makeStyles } from '@material-ui/core/styles';
import {
  audienceProblem,
  DEFAULT_CANARY_STEPS,
  reachUnsupported,
  type EndpointCapability,
  type EndpointHeaderMatch,
  type RolloutPlan,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import { StepsField } from './StepsField';

const useStyles = makeStyles(theme => ({
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  number: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    color: theme.palette.primary.dark,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  label: { fontWeight: 600 },
  audience: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 160px minmax(0, 1fr)',
    gap: theme.spacing(1),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
}));

/** A form section's heading, numbered when the page counts its sections. */
export const SectionLabel = ({
  number,
  children,
}: {
  number?: number;
  children: ReactNode;
}) => {
  const classes = useStyles();
  return (
    <Box className={classes.sectionLabel}>
      {number !== undefined && (
        <span className={classes.number} aria-hidden="true">
          {number}
        </span>
      )}
      <Typography variant="body2" className={classes.label}>
        {children}
      </Typography>
    </Box>
  );
};

/** Copy shares to start from; 100% alone copies every request at once. */
const MIRROR_PRESETS = [[5, 25, 50, 100], [10, 50, 100], [100]];

/** Header conditions to start from; each fills the fields and can be edited. */
const AUDIENCE_PRESETS: {
  label: string;
  header: EndpointHeaderMatch;
  hint: string;
}[] = [
  {
    label: 'Phones',
    header: {
      name: 'user-agent',
      type: 'RegularExpression',
      value: '.*Mobi.*',
    },
    hint: "Browsers on phones put 'Mobi' in their User-Agent. iPads and apps that send their own User-Agent are missed.",
  },
  {
    label: 'Chromium on mobile',
    header: { name: 'sec-ch-ua-mobile', type: 'Exact', value: '?1' },
    hint: 'Chrome, Edge and other Chromium browsers send this hint on mobile; Safari and Firefox do not.',
  },
  {
    label: 'Your app',
    header: { name: 'X-Client', type: 'Exact', value: 'ios' },
    hint: 'Use the header your app already sends, such as X-Client: ios. The most reliable choice for native apps.',
  },
];

/** How a rollout reaches its new version: steps, preview, cookie group or copy share. */
export interface RolloutOptions {
  steps: number[];
  useHeader: boolean;
  headerName: string;
  headerValue: string;
  previewBy: 'header' | 'path';
  previewPath: string;
  cookieName: string;
  cookieValue: string;
  /**
   * A/B: a header the cookie group must also send, as Flagger's
   * analysis.match and Argo Rollouts' setHeaderRoute allow.
   */
  audienceOn: boolean;
  audience: EndpointHeaderMatch;
}

/**
 * The Endpoint type's name and the routing features it renders, which limit
 * the options; unset capabilities limit nothing.
 */
export interface RolloutTypeSupport {
  typeName?: string;
  capabilities?: EndpointCapability[];
}

/** The options a strategy starts with; the cookie is named after the Endpoint. */
export function defaultRolloutOptions(
  strategy: RolloutStrategy,
  endpointName: string,
  support: RolloutTypeSupport = {},
): RolloutOptions {
  return withStrategyDefaults(
    {
      steps: DEFAULT_CANARY_STEPS,
      useHeader: true,
      headerName: 'x-canary',
      headerValue: 'true',
      previewBy: 'header',
      previewPath: '/preview',
      cookieName: `exp_${endpointName.replace(/[^A-Za-z0-9_]/g, '_')}`,
      cookieValue: 'b',
      audienceOn: false,
      audience: {
        name: 'user-agent',
        type: 'RegularExpression',
        value: '.*Mobi.*',
      },
    },
    strategy,
    support,
  );
}

/**
 * The testers' header a strategy suggests, kept on the other options. A
 * canary's header starts off when the type can't match one.
 */
export function withStrategyDefaults(
  options: RolloutOptions,
  strategy: RolloutStrategy,
  support: RolloutTypeSupport = {},
): RolloutOptions {
  return {
    ...options,
    headerName: strategy === 'blueGreen' ? 'x-preview' : 'x-canary',
    headerValue: strategy === 'blueGreen' ? 'green' : 'true',
    useHeader: strategy !== 'abTest' && !headerUnsupported(support),
  };
}

function headerUnsupported({ capabilities, typeName }: RolloutTypeSupport) {
  return reachUnsupported({ testersHeader: true }, capabilities, typeName);
}

/**
 * The part of a RolloutPlan the options decide, or null while one the
 * strategy needs is missing.
 */
export function rolloutOptionsPlan(
  strategy: RolloutStrategy,
  o: RolloutOptions,
): Pick<RolloutPlan, 'steps' | 'preview' | 'mirrorPercent'> | null {
  if (strategy === 'abTest') {
    return o.cookieName && o.cookieValue
      ? {
          preview: {
            kind: 'cookie',
            name: o.cookieName,
            value: o.cookieValue,
            ...(o.audienceOn && { audience: o.audience }),
          },
        }
      : null;
  }
  if (strategy === 'mirror') {
    return o.steps.length > 0 ? { steps: o.steps } : null;
  }
  if (strategy === 'blueGreen' && o.previewBy === 'path') {
    return o.previewPath
      ? { preview: { kind: 'path', name: 'path', value: o.previewPath } }
      : null;
  }
  if (strategy === 'blueGreen' && (!o.headerName || !o.headerValue)) {
    return null;
  }
  if (strategy === 'canary' && o.steps.length === 0) return null;
  return {
    ...(strategy === 'canary' && { steps: o.steps }),
    ...((strategy === 'blueGreen' || o.useHeader) &&
      o.headerName &&
      o.headerValue && {
        preview: {
          kind: 'header' as const,
          name: o.headerName,
          value: o.headerValue,
        },
      }),
  };
}

/** Why the options can't be saved yet, or an empty string. */
export function rolloutOptionsProblem(
  strategy: RolloutStrategy,
  o: RolloutOptions,
  { capabilities, typeName }: RolloutTypeSupport = {},
): string {
  if (strategy === 'abTest' && o.audienceOn && audienceProblem(o.audience)) {
    return audienceProblem(o.audience)!;
  }
  const unsupported = reachUnsupported(
    {
      testersHeader: strategy === 'canary' && o.useHeader,
      audience: strategy === 'abTest' && o.audienceOn ? o.audience : undefined,
      mirrorShares: strategy === 'mirror' ? o.steps : undefined,
    },
    capabilities,
    typeName,
  );
  if (unsupported) return unsupported;
  return rolloutOptionsPlan(strategy, o)
    ? ''
    : 'Fill in how to reach the new backend';
}

/**
 * A strategy's options, as Add backend and Create Endpoint both show them:
 * a canary's steps, then how people reach the new version (testers' header
 * or path, the cookie group, or the share of traffic to copy).
 */
export const RolloutOptionsFields = ({
  strategy,
  value,
  onChange,
  stableName,
  matchProblem,
  support = {},
  firstNumber,
}: {
  strategy: RolloutStrategy;
  value: RolloutOptions;
  onChange: (next: RolloutOptions) => void;
  /** The version the new one runs next to, for the mirror's caption. */
  stableName: string;
  matchProblem?: string;
  support?: RolloutTypeSupport;
  /** Numbers the sections from this one, as Add backend counts them. */
  firstNumber?: number;
}) => {
  const classes = useStyles();
  const set = (patch: Partial<RolloutOptions>) =>
    onChange({ ...value, ...patch });
  const setAudience = (patch: Partial<EndpointHeaderMatch>) =>
    set({ audience: { ...value.audience, ...patch } });
  const { audience } = value;
  const noHeader = headerUnsupported(support);
  const stepped = strategy === 'canary' || strategy === 'mirror';
  const reachNumber =
    firstNumber === undefined ? undefined : firstNumber + (stepped ? 1 : 0);

  return (
    <>
      {stepped && (
        <Box className={classes.field}>
          <SectionLabel number={firstNumber}>
            {strategy === 'mirror' ? 'Copy steps' : 'Steps'}
          </SectionLabel>
          <StepsField
            value={value.steps}
            onChange={steps => set({ steps })}
            presets={strategy === 'mirror' ? MIRROR_PRESETS : undefined}
          />
          {strategy === 'mirror' && (
            <Typography variant="caption" color="textSecondary">
              Nothing is copied until you take the first step in an
              environment.
              Users always get {stableName}'s answer; the new backend's answers
              are discarded. Copies of writes (POST, PUT) run too, so give it
              its own database.
            </Typography>
          )}
        </Box>
      )}

      {strategy !== 'mirror' && (
        <Box className={classes.field}>
          <SectionLabel number={reachNumber}>
            {strategy === 'abTest' && 'Who sees the new backend'}
            {(strategy === 'canary' || strategy === 'blueGreen') &&
              'Let testers reach it first'}
          </SectionLabel>
          {matchProblem && (
            <Typography variant="caption" color="error">
              {matchProblem}
            </Typography>
          )}
          {strategy === 'blueGreen' && (
            <RadioGroup
              row
              aria-label="Preview with"
              value={value.previewBy}
              onChange={e =>
                set({ previewBy: e.target.value as 'header' | 'path' })
              }
            >
              <FormControlLabel
                value="header"
                control={<Radio color="primary" size="small" />}
                label="A header"
              />
              <FormControlLabel
                value="path"
                control={<Radio color="primary" size="small" />}
                label="A path"
              />
            </RadioGroup>
          )}
          {strategy === 'blueGreen' && value.previewBy === 'path' && (
            <Box maxWidth={316}>
              <TextField
                id="rollout-preview-path"
                fullWidth
                size="small"
                variant="outlined"
                label="Path"
                value={value.previewPath}
                onChange={e => set({ previewPath: e.target.value })}
                helperText="Relative to the Endpoint's own path, e.g. /preview"
              />
            </Box>
          )}
          {strategy === 'canary' && (
            <FormControlLabel
              control={
                <Checkbox
                  color="primary"
                  checked={value.useHeader}
                  disabled={Boolean(noHeader) && !value.useHeader}
                  onChange={e => set({ useHeader: e.target.checked })}
                />
              }
              label="Requests with a header always reach the new version"
            />
          )}
          {strategy === 'canary' && noHeader && (
            <Typography variant="caption" color="textSecondary">
              {support.typeName ?? 'This type'} can't route by a header, so
              testers reach the new version only through the steps.
            </Typography>
          )}
          {((strategy === 'blueGreen' && value.previewBy === 'header') ||
            (strategy === 'canary' && value.useHeader)) && (
            <Box className={classes.pair}>
              <TextField
                id="rollout-header-name"
                size="small"
                variant="outlined"
                label="Header"
                value={value.headerName}
                onChange={e => set({ headerName: e.target.value })}
              />
              <TextField
                id="rollout-header-value"
                size="small"
                variant="outlined"
                label="Value"
                value={value.headerValue}
                onChange={e => set({ headerValue: e.target.value })}
              />
            </Box>
          )}
          {strategy === 'abTest' && (
            <>
              <Box className={classes.pair}>
                <TextField
                  id="rollout-cookie-name"
                  size="small"
                  variant="outlined"
                  label="Cookie"
                  value={value.cookieName}
                  onChange={e => set({ cookieName: e.target.value })}
                />
                <TextField
                  id="rollout-cookie-value"
                  size="small"
                  variant="outlined"
                  label="New version's value"
                  value={value.cookieValue}
                  onChange={e => set({ cookieValue: e.target.value })}
                />
              </Box>
              <Typography variant="caption" color="textSecondary">
                Your app sets this cookie once per visitor. Visitors with this
                value get the new version, and keep seeing the same one.
              </Typography>
              <Typography variant="body2" className={classes.label}>
                Who takes part
              </Typography>
              <RadioGroup
                aria-label="Who takes part"
                value={value.audienceOn ? 'header' : 'everyone'}
                onChange={e => set({ audienceOn: e.target.value === 'header' })}
              >
                <FormControlLabel
                  value="everyone"
                  control={<Radio color="primary" size="small" />}
                  label="Everyone in the cookie group"
                />
                <FormControlLabel
                  value="header"
                  control={<Radio color="primary" size="small" />}
                  label="Only requests that also send a header"
                />
              </RadioGroup>
              {value.audienceOn && (
                <>
                  <Box display="flex" flexWrap="wrap" gridGap={8}>
                    {AUDIENCE_PRESETS.map(p => (
                      <Button
                        key={p.label}
                        size="small"
                        variant="outlined"
                        onClick={() => set({ audience: p.header })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </Box>
                  <Box className={classes.audience}>
                    <TextField
                      id="rollout-audience-name"
                      size="small"
                      variant="outlined"
                      label="Header"
                      value={audience.name}
                      onChange={e => setAudience({ name: e.target.value })}
                    />
                    <TextField
                      id="rollout-audience-type"
                      select
                      size="small"
                      variant="outlined"
                      label="Match"
                      value={audience.type ?? 'Exact'}
                      onChange={e =>
                        setAudience({
                          type: e.target.value as EndpointHeaderMatch['type'],
                        })
                      }
                    >
                      <MenuItem value="Exact">is exactly</MenuItem>
                      <MenuItem
                        value="RegularExpression"
                        disabled={
                          Boolean(support.capabilities?.length) &&
                          !support.capabilities?.includes('RegularExpression')
                        }
                      >
                        matches regex
                      </MenuItem>
                    </TextField>
                    <TextField
                      id="rollout-audience-value"
                      size="small"
                      variant="outlined"
                      label="Value"
                      value={audience.value}
                      error={Boolean(audienceProblem(audience))}
                      helperText={audienceProblem(audience)}
                      onChange={e => setAudience({ value: e.target.value })}
                    />
                  </Box>
                  <Typography variant="caption" color="textSecondary">
                    {AUDIENCE_PRESETS.find(
                      p =>
                        p.header.name === audience.name &&
                        p.header.value === audience.value,
                    )?.hint ??
                      'Both the cookie and this header must match. A header your app sends is the most reliable.'}
                  </Typography>
                </>
              )}
            </>
          )}
        </Box>
      )}
    </>
  );
};
