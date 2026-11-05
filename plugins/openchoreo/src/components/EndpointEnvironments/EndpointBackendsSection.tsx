import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import AddIcon from '@material-ui/icons/Add';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import EditOutlinedIcon from '@material-ui/icons/EditOutlined';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import { useNavigate } from 'react-router-dom';
import {
  EndpointBackendList,
  type EndpointBackend,
} from '../EndpointOverview/EndpointBackendList';
import {
  hasShare,
  type EndpointBackendWeight,
} from '@openchoreo/backstage-plugin-common';
import { EditShareDialog } from './progressive/EditShareDialog';
import { pairFirst, roleOf } from './progressive/endpointUi';
import { ProgressiveDeliveryEntry } from './progressive/ProgressiveDeliveryEntry';
import { useProgressiveDelivery } from './progressive/ProgressiveDeliveryContext';
import { RolloutPairGroup } from './progressive/RolloutPairGroup';
import { RemoveBackendDialog } from './EndpointBackendDialogs';

/** The most backends an Endpoint takes, as the Endpoint CRD allows. */
const MAX_BACKENDS = 16;

/**
 * How long after a change to look for the release it cuts: the controller
 * cuts it within seconds, and the catalog entity follows by event.
 */
const RELEASE_RECHECK_MS = [3000, 8000];

const FROZEN =
  'Finish the rollout first. While it runs, the other backends stay as they are.';

/**
 * The Endpoint's backends on the Set up pane, where they are changed: added
 * (moving a component-managed Endpoint to its project), given a share and
 * removed. While a rollout runs, its pair is grouped with its Finish button and
 * the other backends stay as they are. Each change cuts a new release, which the pane then offers to
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
  const [editing, setEditing] = useState<EndpointBackendWeight | null>(null);
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
        weight: b.weight,
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

  const pdBackends = pd?.endpoint.backends ?? [];
  const byName = new Map(pdBackends.map(b => [b.name ?? b.componentName, b]));
  const shared = pdBackends.filter(hasShare);
  const inPair = (b: EndpointBackend) => Boolean(roleOf(b.name, rollout));
  const pair = pairFirst(backends.filter(inPair), b => b.name, rollout);
  const others = backends.filter(b => !inPair(b));

  let addBlocked = '';
  if (rollout) {
    addBlocked = `One rollout at a time. Finish ${rollout.stable} → ${rollout.candidate} first.`;
  } else if (backends.length >= MAX_BACKENDS) {
    addBlocked = `An Endpoint takes at most ${MAX_BACKENDS} backends.`;
  }

  const renderActions = (backend: EndpointBackend) => {
    const own = byName.get(backend.name);
    // A backend reached by its match or copies has no share to edit.
    const sharable = own ? hasShare(own) : (backend.weight ?? 1) > 0;
    let editBlocked = rollout ? FROZEN : '';
    if (!editBlocked && shared.length === 1) {
      editBlocked = `${backend.name} gets every request no match takes.`;
    }
    let removeBlocked = rollout ? FROZEN : '';
    if (!removeBlocked && backends.length === 1) {
      removeBlocked = 'An Endpoint needs at least one backend.';
    }
    return (
      <>
        {sharable && (
          <Tooltip title={editBlocked || 'Edit share'}>
            <span>
              <IconButton
                size="small"
                aria-label={`Edit share of ${backend.name}`}
                onClick={() => setEditing(own ?? null)}
                disabled={Boolean(editBlocked) || !own}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={removeBlocked || 'Remove backend'}>
          <span>
            <IconButton
              size="small"
              aria-label={`Remove ${backend.name}`}
              onClick={() => setRemoving(backend)}
              disabled={Boolean(removeBlocked)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </>
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
        <Tooltip title={addBlocked}>
          <span>
            <Button
              size="small"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => navigate('add-backend')}
              disabled={Boolean(addBlocked)}
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

      {backends.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          No backends configured.
        </Typography>
      )}
      {pair.length > 0 && (
        <RolloutPairGroup backends={pair} namespace={namespace} />
      )}
      {others.length > 0 && (
        <EndpointBackendList
          backends={others}
          namespace={namespace}
          showShares={!rollout}
          renderActions={renderActions}
        />
      )}

      <ProgressiveDeliveryEntry />

      <EditShareDialog
        backend={editing}
        backends={pdBackends}
        entity={entity}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
      <RemoveBackendDialog
        backend={removing}
        entity={entity}
        onClose={() => setRemoving(null)}
        onSaved={handleSaved}
      />
    </Box>
  );
};
