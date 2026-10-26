import {
  Box,
  Button,
  IconButton,
  ListItemText,
  TextField,
  Typography,
} from '@material-ui/core';
import Autocomplete from '@material-ui/lab/Autocomplete';
import AddIcon from '@material-ui/icons/Add';
import RemoveCircleOutlineIcon from '@material-ui/icons/RemoveCircleOutline';
import type { EndpointCandidate } from '@openchoreo/backstage-plugin-common';

/** One backend row: a component workload endpoint and its weight. */
export interface EndpointBackendRow {
  componentName: string;
  endpoint: string;
  weight: number;
  /** False for a backend typed in that is not deployed anywhere yet. */
  deployed: boolean;
}

/** A deployed component workload endpoint, as offered in the dropdowns. */
export interface EndpointBackendOption {
  componentName: string;
  endpoint: string;
  protocol?: string;
  environments: string[];
  externalURL?: string;
  routedBy?: EndpointCandidate['endpoints'][number]['routedBy'];
}

export const backendRowKey = (o: { componentName: string; endpoint: string }) =>
  `${o.componentName}/${o.endpoint}`;

/** Parses typed text "component/endpoint", defaulting the endpoint to http. */
const parseTyped = (text: string) => {
  const [componentName, endpoint] = text.trim().split('/', 2);
  return { componentName: componentName ?? '', endpoint: endpoint || 'http' };
};

/** The dropdown options for a project's deployed component endpoints. */
export function backendOptions(
  candidates: EndpointCandidate[],
): EndpointBackendOption[] {
  return candidates.flatMap(c =>
    c.endpoints.map(e => ({
      componentName: c.componentName,
      endpoint: e.name,
      protocol: e.protocol,
      environments: e.environments,
      externalURL: e.externalURL,
      routedBy: e.routedBy,
    })),
  );
}

/**
 * What is wrong with a set of backend rows, first problem first: empty or
 * duplicate rows, a backend not deployed yet with traffic, or no traffic.
 */
export function backendRowErrors(rows: EndpointBackendRow[]): string[] {
  if (rows.some(r => !r.componentName)) {
    return ['Pick a component for every backend, or remove the empty row'];
  }
  if (rows.length === 0) return ['Add at least one backend'];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(backendRowKey(r))) {
      errors.push(`${backendRowKey(r)} is listed twice`);
    }
    seen.add(backendRowKey(r));
    if (!r.deployed && r.weight > 0) {
      errors.push(
        `${backendRowKey(
          r,
        )} is not deployed yet; keep it at 0% until it is deployed`,
      );
    }
  }
  if (!rows.some(r => r.weight > 0)) {
    errors.push('At least one backend needs a weight above 0');
  }
  return errors;
}

export interface EndpointBackendRowsProps {
  rows: EndpointBackendRow[];
  options: EndpointBackendOption[];
  onChange: (rows: EndpointBackendRow[]) => void;
  disabled?: boolean;
}

/**
 * Edits an Endpoint's backends: one picker per version, and a weight for
 * each once there is more than one. A backend that is not deployed yet can
 * be typed in as `component/endpoint`; it stays at 0% until it is deployed.
 * Used by the create template and the Configure Endpoint page.
 */
export const EndpointBackendRows = ({
  rows,
  options,
  onChange,
  disabled,
}: EndpointBackendRowsProps) => {
  const byKey = new Map(options.map(o => [backendRowKey(o), o]));

  const setRow = (index: number, row: Partial<EndpointBackendRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...row } : r)));

  const pickBackend = (
    index: number,
    picked: EndpointBackendOption | string | null,
  ) => {
    if (picked === null) return;
    const target = typeof picked === 'string' ? parseTyped(picked) : picked;
    if (!target.componentName) return;
    setRow(index, {
      componentName: target.componentName,
      endpoint: target.endpoint,
      deployed: byKey.has(backendRowKey(target)),
    });
  };

  const total = rows.reduce((sum, r) => sum + (r.weight || 0), 0);

  return (
    <Box display="flex" flexDirection="column" gridGap={8}>
      {rows.map((row, i) => (
        <Box key={i} display="flex" alignItems="flex-start" gridGap={8}>
          <Autocomplete<EndpointBackendOption, false, false, true>
            freeSolo
            fullWidth
            disabled={disabled}
            options={options}
            value={
              row.componentName
                ? byKey.get(backendRowKey(row)) ?? backendRowKey(row)
                : null
            }
            getOptionLabel={o => (typeof o === 'string' ? o : backendRowKey(o))}
            renderOption={o => (
              <ListItemText
                primary={`${o.componentName} / ${o.endpoint}`}
                secondary={[
                  o.environments.join(', '),
                  ...(o.routedBy ?? []).map(
                    e =>
                      `routed by ${e.endpointName} (${e.visibility.join(
                        ', ',
                      )})`,
                  ),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            )}
            onChange={(_e, picked) => pickBackend(i, picked)}
            onInputChange={(_e, text, reason) => {
              if (reason === 'input' && text.includes('/'))
                pickBackend(i, text);
            }}
            renderInput={params => (
              <TextField
                {...params}
                variant="outlined"
                size="small"
                label="Component / endpoint"
                helperText={
                  row.componentName && !row.deployed
                    ? 'Not deployed yet; keep it at 0% until it is deployed'
                    : undefined
                }
              />
            )}
          />
          {rows.length > 1 && (
            <TextField
              type="number"
              variant="outlined"
              size="small"
              label="Weight"
              disabled={disabled}
              value={row.weight}
              onChange={e =>
                setRow(i, {
                  weight: Math.max(0, Number(e.target.value) || 0),
                })
              }
              inputProps={{ min: 0, max: 1000000, step: 1 }}
              style={{ width: 120 }}
            />
          )}
          <IconButton
            size="small"
            aria-label={`Remove backend ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            disabled={disabled || rows.length <= 1}
          >
            <RemoveCircleOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Button
          size="small"
          color="primary"
          startIcon={<AddIcon />}
          disabled={disabled}
          onClick={() =>
            onChange([
              ...rows,
              {
                componentName: '',
                endpoint: 'http',
                weight: 0,
                deployed: true,
              },
            ])
          }
        >
          Split with another version
        </Button>
        {rows.length > 1 && (
          <Typography variant="caption" color="textSecondary">
            Weights are relative; total {total}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="textSecondary">
        Pick a deployed component, or type <code>component/endpoint</code> for
        one that is not deployed yet.
      </Typography>
    </Box>
  );
};
