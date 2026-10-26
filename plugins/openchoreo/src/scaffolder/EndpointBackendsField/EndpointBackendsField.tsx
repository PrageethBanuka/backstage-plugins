import { useEffect, useMemo, useState } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import type { FieldValidation } from '@rjsf/utils';
import {
  Box,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Typography,
} from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import type {
  EndpointCandidate,
  EndpointVisibility,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import {
  backendOptions,
  backendRowErrors,
  backendRowKey as keyOf,
  EndpointBackendRows,
  type EndpointBackendRow,
} from '../../components/Endpoints/EndpointBackendRows';

export type { EndpointBackendRow };

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

  const options = useMemo(() => backendOptions(candidates), [candidates]);
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
        <EndpointBackendRows
          rows={rows}
          options={options}
          onChange={backends => update({ backends })}
        />
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
  for (const e of backendRowErrors(value?.backends ?? [])) {
    validation.addError(e);
  }
};
