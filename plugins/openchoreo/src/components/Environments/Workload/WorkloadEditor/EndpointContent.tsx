import { FC, useEffect } from 'react';
import { Alert } from '@material-ui/lab';
import { WorkloadEndpoint } from '@openchoreo/backstage-plugin-common';
import {
  EndpointList,
  useEndpointEditBuffer,
} from '@openchoreo/backstage-plugin-react';
import { useWorkloadContext } from '../WorkloadContext';

interface EndpointContentProps {
  endpoints: { [key: string]: WorkloadEndpoint };
  onEndpointReplace: (
    endpointName: string,
    endpoint: WorkloadEndpoint,
    oldNameToRemove?: string,
  ) => void;
  onAddEndpoint: () => string;
  onRemoveEndpoint: (endpointName: string) => void;
  disabled: boolean;
  /** Why an endpoint can't be served through its Endpoint, if any. */
  exposedProblem?: string;
}

export const EndpointContent: FC<EndpointContentProps> = ({
  endpoints,
  onEndpointReplace,
  onAddEndpoint,
  onRemoveEndpoint,
  disabled,
  exposedProblem,
}) => {
  const { setEditingSection } = useWorkloadContext();

  const editBuffer = useEndpointEditBuffer({
    endpoints,
    onEndpointReplace,
    onRemoveEndpoint,
  });

  // Report editing state to context
  useEffect(() => {
    setEditingSection('endpoints', editBuffer.isAnyRowEditing);
  }, [editBuffer.isAnyRowEditing, setEditingSection]);

  return (
    <>
      {exposedProblem && (
        <Alert severity="warning" style={{ marginBottom: 8 }}>
          {exposedProblem}. The component's own route keeps serving until this
          is fixed.
        </Alert>
      )}
      <EndpointList
        endpoints={endpoints}
        disabled={disabled}
        editBuffer={editBuffer}
        onRemoveEndpoint={onRemoveEndpoint}
        onAddEndpoint={onAddEndpoint}
      />
    </>
  );
};
