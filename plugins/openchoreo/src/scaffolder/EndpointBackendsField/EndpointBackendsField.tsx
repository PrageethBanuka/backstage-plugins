import { useEffect, useMemo, useState } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import type { FieldValidation } from '@rjsf/utils';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  ListItemText,
  TextField,
  Typography,
} from '@material-ui/core';
import Autocomplete from '@material-ui/lab/Autocomplete';
import AddIcon from '@material-ui/icons/Add';
import RemoveCircleOutlineIcon from '@material-ui/icons/RemoveCircleOutline';
import { useApi } from '@backstage/core-plugin-api';
import type {
  EndpointCandidate,
  EndpointVisibility,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';

/** One backend row of the form. */
export interface EndpointBackendRow {
  componentName: string;
  endpoint: string;
  weight: number;
  /** False for a backend typed in that is not deployed anywhere yet. */
  deployed: boolean;
}

/**
 * The field's value: where the Endpoint is reachable from and its backends.
 * The create action reads both.
 */
export interface EndpointRoutingValue {
  visibility: EndpointVisibility[];
  backends: EndpointBackendRow[];
  /**
   * Endpoints that already route a picked backend in a picked visibility,
   * as "component/endpoint → endpoint (visibility)". Only carries the check
   * to validation.
   */
  conflicts?: string[];
}

export const EndpointBackendsFieldSchema = {
  returnValue: {
    type: 'object' as const,
    properties: {
      visibility: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      conflicts: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      backends: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            componentName: { type: 'string' as const },
            endpoint: { type: 'string' as const },
            weight: { type: 'number' as const },
            deployed: { type: 'boolean' as const },
          },
        },
      },
    },
  },
};

const VISIBILITIES: { value: EndpointVisibility; label: string }[] = [
  { value: 'external', label: 'External (public gateway)' },
  { value: 'internal', label: 'Internal (internal gateway)' },
  { value: 'namespace', label: 'Namespace (in-cluster callers)' },
];

/** A deployed component workload endpoint, as offered in the dropdowns. */
interface Option {
  componentName: string;
  endpoint: string;
  protocol?: string;
  environments: string[];
  externalURL?: string;
  routedBy?: EndpointCandidate['endpoints'][number]['routedBy'];
}

const keyOf = (o: { componentName: string; endpoint: string }) =>
  `${o.componentName}/${o.endpoint}`;

/** Parses typed text "component/endpoint", defaulting the endpoint to http. */
const parseTyped = (text: string) => {
  const [componentName, endpoint] = text.trim().split('/', 2);
  return { componentName: componentName ?? '', endpoint: endpoint || 'http' };
};

const lastSegment = (value: unknown) =>
  typeof value === 'string' ? value.split('/').pop() ?? '' : '';

/** Reads a dotted path such as `project_namespace` from the form data. */
const readPath = (data: any, path: string) =>
  path
    .split('.')
    .reduce(
      (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
      data,
    );

/**
 * Picks the URL a new Endpoint serves and its backends from the project's
 * deployed component endpoints. A backend that is not deployed yet can be
 * typed in as `component/endpoint`; it stays at 0% until it is deployed.
 */
export const EndpointBackendsField = ({
  formData,
  onChange,
  formContext,
  uiSchema,
}: FieldExtensionComponentProps<EndpointRoutingValue>) => {
  const client = useApi(openChoreoClientApiRef);
  const projectField =
    (uiSchema?.['ui:options']?.projectField as string) || 'project_namespace';
  const projectNamespace = readPath(formContext.formData, projectField) ?? {};
  const namespaceName = lastSegment(projectNamespace.namespace_name);
  const projectName = lastSegment(projectNamespace.project_name);

  const [candidates, setCandidates] = useState<EndpointCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!namespaceName || !projectName) return undefined;
    let ignore = false;
    setLoading(true);
    setLoadError(undefined);
    client
      .fetchEndpointCandidates(namespaceName, projectName)
      .then(list => {
        if (!ignore) setCandidates(list);
      })
      .catch(err => {
        if (!ignore)
          setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [client, namespaceName, projectName]);

  const options: Option[] = useMemo(
    () =>
      candidates.flatMap(c =>
        c.endpoints.map(e => ({
          componentName: c.componentName,
          endpoint: e.name,
          protocol: e.protocol,
          environments: e.environments,
          externalURL: e.externalURL,
          routedBy: e.routedBy,
        })),
      ),
    [candidates],
  );
  const byKey = useMemo(
    () => new Map(options.map(o => [keyOf(o), o])),
    [options],
  );

  const value: EndpointRoutingValue = formData ?? {
    visibility: ['external'],
    backends: [
      { componentName: '', endpoint: 'http', weight: 100, deployed: true },
    ],
  };
  const rows = value.backends ?? [];
  const visibility = value.visibility ?? ['external'];

  /**
   * One Endpoint routes a component workload endpoint in a visibility, so a
   * backend another Endpoint already routes there is a conflict: add the
   * backend to that Endpoint instead, or pick another visibility.
   */
  const conflictsFor = (
    backends: EndpointBackendRow[],
    vis: EndpointVisibility[],
  ): string[] =>
    backends.flatMap(r =>
      (byKey.get(keyOf(r))?.routedBy ?? []).flatMap(e =>
        e.visibility
          .filter(v => vis.includes(v))
          .map(
            v => `${keyOf(r)} is already routed by ${e.endpointName} (${v})`,
          ),
      ),
    );

  const update = (next: Partial<EndpointRoutingValue>) => {
    const merged = { ...value, visibility, ...next };
    onChange({
      ...merged,
      conflicts: conflictsFor(merged.backends ?? [], merged.visibility),
    });
  };

  const toggleVisibility = (v: EndpointVisibility) =>
    update({
      visibility: visibility.includes(v)
        ? visibility.filter(x => x !== v)
        : [...visibility, v],
    });

  const setRow = (index: number, row: Partial<EndpointBackendRow>) =>
    update({
      backends: rows.map((r, i) => (i === index ? { ...r, ...row } : r)),
    });

  const pickBackend = (index: number, picked: Option | string | null) => {
    if (picked === null) return;
    const target = typeof picked === 'string' ? parseTyped(picked) : picked;
    if (!target.componentName) return;
    setRow(index, {
      componentName: target.componentName,
      endpoint: target.endpoint,
      deployed: byKey.has(keyOf(target)),
    });
  };

  const addRow = () =>
    update({
      backends: [
        ...rows,
        { componentName: '', endpoint: 'http', weight: 0, deployed: true },
      ],
    });

  const removeRow = (index: number) =>
    update({ backends: rows.filter((_, i) => i !== index) });

  const total = rows.reduce((sum, r) => sum + (r.weight || 0), 0);

  if (!namespaceName || !projectName) {
    return (
      <Typography variant="body2" color="textSecondary">
        Pick a project first.
      </Typography>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gridGap={16}>
      <Box display="flex" flexDirection="column">
        <Typography variant="subtitle2">Reachable from</Typography>
        <Box display="flex" flexWrap="wrap">
          {VISIBILITIES.map(v => (
            <FormControlLabel
              key={v.value}
              control={
                <Checkbox
                  color="primary"
                  checked={visibility.includes(v.value)}
                  onChange={() => toggleVisibility(v.value)}
                />
              }
              label={v.label}
            />
          ))}
        </Box>
        <Typography variant="caption" color="textSecondary">
          The Endpoint type renders a route for each. Gateway and in-cluster
          callers get the same split.
        </Typography>
        {loadError && (
          <Typography variant="caption" color="error">
            Failed to load the project's components: {loadError}
          </Typography>
        )}
        {loading && <CircularProgress size={18} />}
      </Box>

      <Box display="flex" flexDirection="column" gridGap={8}>
        <Typography variant="subtitle2">
          {rows.length > 1 ? 'Versions and their weights' : 'Serves'}
        </Typography>
        {rows.map((row, i) => (
          <Box key={i} display="flex" alignItems="flex-start" gridGap={8}>
            <Autocomplete<Option, false, false, true>
              freeSolo
              fullWidth
              options={options}
              value={
                row.componentName ? byKey.get(keyOf(row)) ?? keyOf(row) : null
              }
              getOptionLabel={o => (typeof o === 'string' ? o : keyOf(o))}
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
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1}
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
            onClick={addRow}
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
    </Box>
  );
};

export const endpointBackendsFieldValidation = (
  value: EndpointRoutingValue | undefined,
  validation: FieldValidation,
) => {
  if (!value?.visibility?.length) {
    validation.addError('Pick where the Endpoint is reachable from');
  }
  for (const c of value?.conflicts ?? []) {
    validation.addError(
      `${c}; add the backend to that Endpoint, or pick another visibility`,
    );
  }
  const rows = value?.backends ?? [];
  if (rows.some(r => !r.componentName)) {
    validation.addError(
      'Pick a component for every backend, or remove the empty row',
    );
    return;
  }
  if (rows.length === 0) {
    validation.addError('Add at least one backend');
    return;
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(keyOf(r))) {
      validation.addError(`${keyOf(r)} is listed twice`);
    }
    seen.add(keyOf(r));
    if (!r.deployed && r.weight > 0) {
      validation.addError(
        `${keyOf(r)} is not deployed yet; keep it at 0% until it is deployed`,
      );
    }
  }
  if (!rows.some(r => r.weight > 0)) {
    validation.addError('At least one backend needs a weight above 0');
  }
};
