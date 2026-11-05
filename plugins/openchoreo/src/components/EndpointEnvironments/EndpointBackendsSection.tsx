import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import AddIcon from '@material-ui/icons/Add';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import { useNavigate } from 'react-router-dom';
import {
  EndpointBackendList,
  type EndpointBackend,
} from '../EndpointOverview/EndpointBackendList';
import { ProgressiveDeliveryEntry } from './progressive/ProgressiveDeliveryEntry';
import { useProgressiveDelivery } from './progressive/ProgressiveDeliveryContext';
import { servingEnvironments } from './progressive/endpointRolloutUi';
import { RemoveBackendDialog } from './EndpointBackendDialogs';

/** The most backends an Endpoint takes, as the Endpoint CRD allows. */
const MAX_BACKENDS = 16;

/**
 * How long after a change to look for the release it cuts: the controller
 * cuts it within seconds, and the catalog entity follows by event.
 */
const RELEASE_RECHECK_MS = [3000, 8000];

/**
 * The Endpoint's backends on the Set up pane, where they are changed: added
 * (moving a component-managed Endpoint to its project), reweighted and
 * removed. Each change cuts a new release, which the pane then offers to
 * deploy; `onChanged` is called to look for it.
 */
export const EndpointBackendsSection = ({
  onChanged,
}: {
  onChanged: () => void;
}) => {
  const { entity } = useEntity();
  const { refresh } = useAsyncEntity();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<EndpointBackend | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const spec = (entity.spec ?? {}) as {
    backends?: EndpointBackend[];
    managedByComponent?: string;
  };
  // The Endpoint's own backends when progressive delivery has read them:
  // the catalog entity follows the Endpoint only after a refresh.
  const pd = useProgressiveDelivery();
  const live = pd?.endpoint.backends;
  const rollout = pd?.endpoint.rollout;
  const backends: EndpointBackend[] = live
    ? live.map(b => ({
        name: b.name ?? b.componentName,
        kind: 'Component',
        component: b.componentName,
        endpoint: b.endpoint,
        releaseLine: b.releaseLine,
      }))
    : spec.backends ?? [];
  const namespace = entity.metadata.namespace ?? 'default';

  const handleSaved = (message: string) => {
    setSaved(
      `${message} A new release is cut in a few seconds; deploy it below.`,
    );
    onChanged();
    timers.current.forEach(clearTimeout);
    timers.current = RELEASE_RECHECK_MS.map(ms =>
      setTimeout(() => {
        refresh?.();
        onChanged();
      }, ms),
    );
  };

  return (
    <Box>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={1}
      >
        <Typography variant="subtitle2">
          Backends ({backends.length})
        </Typography>
        <Tooltip
          title={
            backends.length >= MAX_BACKENDS
              ? `An Endpoint takes at most ${MAX_BACKENDS} backends.`
              : ''
          }
        >
          <span>
            <Button
              size="small"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => navigate('add-backend')}
              disabled={backends.length >= MAX_BACKENDS}
            >
              Add backend
            </Button>
          </span>
        </Tooltip>
      </Box>

      {saved && (
        <Box mb={1}>
          <Alert severity="success" onClose={() => setSaved(null)}>
            {saved}
          </Alert>
        </Box>
      )}

      {backends.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          No backends configured.
        </Typography>
      ) : (
        <EndpointBackendList
          backends={backends}
          namespace={namespace}
          showShares={false}
          renderActions={backend => {
            // During a rollout, removing either version finishes it.
            const isNew = backend.name === rollout?.candidate;
            const isCurrent = backend.name === rollout?.stable;
            let removeBlocked =
              backends.length === 1
                ? 'An Endpoint needs at least one backend.'
                : '';
            const serving =
              pd && (isNew || isCurrent)
                ? servingEnvironments(pd.environments, backend.name)
                : [];
            if (isCurrent && rollout?.strategy === 'mirror') {
              removeBlocked =
                'The new version only gets copies. Convert it to a canary first.';
            } else if (serving.length > 0) {
              removeBlocked = `It still gets traffic in ${serving
                .map(e => e.displayName)
                .join(', ')}. Move it to 0% there first.`;
            }
            let removeTitle = removeBlocked || 'Remove backend';
            if (!removeBlocked && isNew) removeTitle = 'Remove the new version';
            if (!removeBlocked && isCurrent)
              removeTitle = 'Keep only the new version';
            const remove = () => {
              if (isNew) pd?.onFinish?.('abandon');
              else if (isCurrent) pd?.onFinish?.('complete');
              else setRemoving(backend);
            };
            return (
              <>
                {(isNew || isCurrent) && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={isNew ? 'primary' : 'default'}
                    label={isNew ? 'New' : 'Current'}
                  />
                )}
                <Tooltip title={removeTitle}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${backend.name}`}
                      onClick={remove}
                      disabled={Boolean(removeBlocked)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            );
          }}
        />
      )}

      <ProgressiveDeliveryEntry />

      <RemoveBackendDialog
        backend={removing}
        entity={entity}
        onClose={() => setRemoving(null)}
        onSaved={handleSaved}
      />
    </Box>
  );
};
