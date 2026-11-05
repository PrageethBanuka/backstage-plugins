import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert, ToggleButton, ToggleButtonGroup } from '@material-ui/lab';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
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
import { PdSection } from './pdLayout';

const useStyles = makeStyles(theme => ({
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  audience: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 180px minmax(0, 1fr)',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  choice: {
    alignSelf: 'flex-start',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  spacer: { flex: 1 },
}));

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
  if (
    (strategy === 'canary' || strategy === 'mirror') &&
    o.steps.length === 0
  ) {
    return 'Pick the steps';
  }
  return rolloutOptionsPlan(strategy, o)
    ? ''
    : 'Fill in how to reach the new backend';
}

/** One-of-two choice, as OpenChoreo's segmented toggles are. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const classes = useStyles();
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      className={classes.choice}
      value={value}
      aria-label={label}
      onChange={(_e, next: T | null) => next && onChange(next)}
    >
      {options.map(o => (
        <ToggleButton key={o.value} value={o.value}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/**
 * A strategy's options, as Add backend and Create Endpoint both show them,
 * one section each: a canary's or a mirror's steps, then how people reach
 * the new version (testers' header, a preview header or path, or the
 * cookie group and who takes part).
 */
export const RolloutOptionsFields = ({
  strategy,
  value,
  onChange,
  stableName,
  matchProblem,
  support = {},
}: {
  strategy: RolloutStrategy;
  value: RolloutOptions;
  onChange: (next: RolloutOptions) => void;
  /** The version the new one runs next to, for the mirror's helper. */
  stableName: string;
  matchProblem?: string;
  support?: RolloutTypeSupport;
}) => {
  const classes = useStyles();
  const [presets, setPresets] = useState<HTMLElement | null>(null);
  const set = (patch: Partial<RolloutOptions>) =>
    onChange({ ...value, ...patch });
  const setAudience = (patch: Partial<EndpointHeaderMatch>) =>
    set({ audience: { ...value.audience, ...patch } });
  const { audience } = value;
  const noHeader = headerUnsupported(support);
  const stepped = strategy === 'canary' || strategy === 'mirror';
  const problem = matchProblem && (
    <Alert severity="error">{matchProblem}</Alert>
  );
  const headerPair = (
    <Box className={classes.pair}>
      <TextField
        id="rollout-header-name"
        variant="outlined"
        label="Header"
        value={value.headerName}
        onChange={e => set({ headerName: e.target.value })}
      />
      <TextField
        id="rollout-header-value"
        variant="outlined"
        label="Value"
        value={value.headerValue}
        onChange={e => set({ headerValue: e.target.value })}
      />
    </Box>
  );

  return (
    <>
      {stepped && (
        <PdSection
          heading={strategy === 'mirror' ? 'Copy steps' : 'Steps'}
          helper={
            strategy === 'mirror'
              ? `The share of requests copied to the new version at each step. Users always get ${stableName}'s answer.`
              : "The new version's share of traffic at each step. The last is always 100%."
          }
        >
          <StepsField
            value={value.steps}
            onChange={steps => set({ steps })}
            presets={strategy === 'mirror' ? MIRROR_PRESETS : undefined}
          />
          {strategy === 'mirror' && (
            <Typography variant="caption" color="textSecondary">
              Nothing is copied until the first step in an environment. Copies
              of writes (POST, PUT) run too, so give the new version its own
              database.
            </Typography>
          )}
        </PdSection>
      )}

      {strategy === 'canary' && (
        <PdSection
          heading="Match"
          helper="Requests with this header reach the new version before any step, in every environment."
        >
          {problem}
          <FormControlLabel
            control={
              <Checkbox
                color="primary"
                checked={value.useHeader}
                disabled={Boolean(noHeader) && !value.useHeader}
                onChange={e => set({ useHeader: e.target.checked })}
              />
            }
            label="Let testers reach it first"
          />
          {noHeader && (
            <Typography variant="caption" color="textSecondary">
              {support.typeName ?? 'This type'} can't route by a header, so
              testers reach the new version only through the steps.
            </Typography>
          )}
          {value.useHeader && headerPair}
        </PdSection>
      )}

      {strategy === 'blueGreen' && (
        <PdSection
          heading="Match"
          helper="Before the switch, only requests with this header or on this path reach the new version."
        >
          {problem}
          <Choice
            label="Preview with"
            value={value.previewBy}
            options={[
              { value: 'header', label: 'Header' },
              { value: 'path', label: 'Path' },
            ]}
            onChange={previewBy => set({ previewBy })}
          />
          {value.previewBy === 'path' ? (
            <Box className={classes.pair}>
              <TextField
                id="rollout-preview-path"
                variant="outlined"
                label="Path"
                value={value.previewPath}
                onChange={e => set({ previewPath: e.target.value })}
                helperText="Relative to the Endpoint's own path, e.g. /preview"
              />
            </Box>
          ) : (
            headerPair
          )}
        </PdSection>
      )}

      {strategy === 'abTest' && (
        <>
          <PdSection
            heading="Match"
            helper="Your app sets this cookie once per visitor. Visitors with this value get the new version, and keep seeing it."
          >
            {problem}
            <Box className={classes.pair}>
              <TextField
                id="rollout-cookie-name"
                variant="outlined"
                label="Cookie"
                value={value.cookieName}
                onChange={e => set({ cookieName: e.target.value })}
              />
              <TextField
                id="rollout-cookie-value"
                variant="outlined"
                label="Cookie value"
                value={value.cookieValue}
                onChange={e => set({ cookieValue: e.target.value })}
              />
            </Box>
          </PdSection>
          <PdSection
            heading="Who takes part"
            helper={
              value.audienceOn
                ? AUDIENCE_PRESETS.find(
                    p =>
                      p.header.name === audience.name &&
                      p.header.value === audience.value,
                  )?.hint ??
                  'Both the cookie and this header must match. A header your app sends is the most reliable.'
                : 'Everyone with the cookie value is in the test group.'
            }
          >
            <Box className={classes.row}>
              <Choice
                label="Who takes part"
                value={value.audienceOn ? 'header' : 'everyone'}
                options={[
                  { value: 'everyone', label: 'Everyone in the group' },
                  { value: 'header', label: 'Only with a header' },
                ]}
                onChange={v => set({ audienceOn: v === 'header' })}
              />
              <span className={classes.spacer} />
              {value.audienceOn && (
                <>
                  <Button
                    color="primary"
                    aria-haspopup="menu"
                    endIcon={<ArrowDropDownIcon />}
                    onClick={e => setPresets(e.currentTarget)}
                  >
                    Presets
                  </Button>
                  <Menu
                    anchorEl={presets}
                    open={Boolean(presets)}
                    onClose={() => setPresets(null)}
                    getContentAnchorEl={null}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  >
                    {AUDIENCE_PRESETS.map(p => (
                      <MenuItem
                        key={p.label}
                        onClick={() => {
                          set({ audience: p.header });
                          setPresets(null);
                        }}
                      >
                        {p.label}
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              )}
            </Box>
            {value.audienceOn && (
              <Box className={classes.audience}>
                <TextField
                  id="rollout-audience-name"
                  variant="outlined"
                  label="Header"
                  value={audience.name}
                  onChange={e => setAudience({ name: e.target.value })}
                />
                <TextField
                  id="rollout-audience-type"
                  select
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
                  variant="outlined"
                  label="Value"
                  value={audience.value}
                  error={Boolean(audienceProblem(audience))}
                  helperText={audienceProblem(audience)}
                  onChange={e => setAudience({ value: e.target.value })}
                />
              </Box>
            )}
          </PdSection>
        </>
      )}
    </>
  );
};
