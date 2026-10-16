import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
} from '@openchoreo/openchoreo-client-node';
import { Config } from '@backstage/config';
import {
  type ImmediateCatalogService,
  translateEndpointToEntity,
} from '@openchoreo/backstage-plugin-catalog-backend-module';

// Kubernetes DNS-1123 label: Endpoint names become route and binding names.
const K8S_LABEL_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 63;

function stripEntityRefPrefix(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1];
}

/**
 * Scaffolder action that creates an OpenChoreo Endpoint via the
 * openchoreo-api and inserts it into the catalog straight away. An Endpoint
 * created here is the same object a Workload endpoint creates by naming an
 * EndpointType: it belongs to the project, routes to its backends with
 * weights, and has its own lifecycle. Creating it routes nothing yet; each
 * environment is routed from the Endpoint's Deploy tab.
 */
export const createEndpointAction = (
  config: Config,
  immediateCatalog: ImmediateCatalogService,
) => {
  return createTemplateAction({
    id: 'openchoreo:endpoint:create',
    description: 'Create OpenChoreo Endpoint',
    schema: {
      input: {
        namespaceName: z =>
          z.string({
            description: 'Namespace where the Endpoint will be created',
          }),
        projectName: z =>
          z.string({ description: 'Project that will own the Endpoint' }),
        endpointName: z =>
          z
            .string({ description: 'Unique name for the Endpoint' })
            .max(
              MAX_NAME_LENGTH,
              `Endpoint name must not exceed ${MAX_NAME_LENGTH} characters`,
            )
            .regex(
              K8S_LABEL_PATTERN,
              'Endpoint name must be lowercase letters, numbers and hyphens, starting and ending with a letter or number.',
            ),
        displayName: z =>
          z
            .string({ description: 'Human-readable name for the Endpoint' })
            .optional(),
        description: z =>
          z.string({ description: 'What this Endpoint is for' }).optional(),
        typeKind: z =>
          z.enum(['EndpointType', 'ClusterEndpointType'], {
            description:
              'Whether the picked type is namespace-scoped (EndpointType) or cluster-scoped (ClusterEndpointType)',
          }),
        typeName: z =>
          z.string({
            description:
              'Name of the (Cluster)EndpointType that renders the route',
          }),
        backends: z =>
          z
            .array(
              z.object({
                componentName: z.string(),
                endpoint: z.string(),
                weight: z.number().int().min(0).max(1000000),
              }),
              {
                description:
                  'Component workload endpoints receiving traffic, with relative weights',
              },
            )
            .min(1, 'Add at least one backend'),
        reclaimPolicy: z =>
          z
            .enum(['Delete', 'Retain'], {
              description:
                'What happens when no backend is left: Delete removes the Endpoint, Retain keeps its URL',
            })
            .optional(),
        parameters: z =>
          z
            .record(z.unknown(), {
              description: "Parameter values bound to the picked type's schema",
            })
            .optional(),
      },
      output: {
        endpointName: z =>
          z.string({ description: 'The name of the created Endpoint' }),
        namespaceName: z =>
          z.string({ description: 'The namespace of the created Endpoint' }),
        projectName: z =>
          z.string({ description: 'The project that owns the Endpoint' }),
        entityRef: z =>
          z.string({
            description: 'Entity reference for the created Endpoint',
          }),
      },
    },
    async handler(ctx) {
      const namespaceName = stripEntityRefPrefix(ctx.input.namespaceName);
      const projectName = stripEntityRefPrefix(ctx.input.projectName);
      const {
        endpointName,
        displayName,
        description,
        typeKind,
        typeName,
        backends,
        reclaimPolicy,
        parameters,
      } = ctx.input;

      const baseUrl = config.getString('openchoreo.baseUrl');
      const authzEnabled =
        config.getOptionalBoolean('openchoreo.features.auth.enabled') ?? true;
      const token = authzEnabled
        ? ctx.secrets?.OPENCHOREO_USER_TOKEN
        : undefined;
      if (authzEnabled && !token) {
        throw new Error(
          'User authentication token not available. Ensure you are logged in.',
        );
      }

      const client = createOpenChoreoApiClient({
        baseUrl,
        token,
        logger: ctx.logger,
      });

      const annotations: Record<string, string> = {};
      if (displayName) annotations['openchoreo.dev/display-name'] = displayName;
      if (description) annotations['openchoreo.dev/description'] = description;
      const hasParameters = parameters && Object.keys(parameters).length > 0;

      const apiBody = {
        metadata: {
          name: endpointName,
          ...(Object.keys(annotations).length > 0 && { annotations }),
        },
        spec: {
          owner: { projectName },
          type: { kind: typeKind, name: typeName },
          backendRefs: backends,
          reclaimPolicy: reclaimPolicy ?? 'Delete',
          ...(hasParameters && { parameters }),
        },
      };

      ctx.logger.info(
        `Creating Endpoint '${endpointName}' in namespace '${namespaceName}'`,
      );
      const { data, error, response } = await client.POST(
        '/api/v1/namespaces/{namespaceName}/endpoints',
        { params: { path: { namespaceName } }, body: apiBody as any },
      );
      assertApiResponse({ data, error, response }, 'create Endpoint');

      const resultName = data?.metadata?.name || endpointName;

      try {
        const defaultOwner =
          config.getOptionalString('openchoreo.defaultOwner') ||
          'openchoreo-users';
        const entity = translateEndpointToEntity(
          {
            name: resultName,
            uid: data?.metadata?.uid,
            displayName,
            description,
            projectName,
            typeName,
            typeKind,
            backends: backends.map(b => ({
              component: b.componentName,
              endpoint: b.endpoint,
              weight: b.weight,
            })),
            createdAt: new Date().toISOString(),
          },
          namespaceName,
          {
            locationKey: 'OpenChoreoEntityProvider',
            defaultOwner: `group:default/${defaultOwner}`,
          },
        );
        await immediateCatalog.insertEntity(entity);
      } catch (catalogError) {
        ctx.logger.error(
          `Failed to immediately add Endpoint to catalog: ${catalogError}. ` +
            `It will be visible after the next scheduled catalog sync.`,
        );
      }

      ctx.output('endpointName', resultName);
      ctx.output('namespaceName', namespaceName);
      ctx.output('projectName', projectName);
      ctx.output('entityRef', `endpoint:${namespaceName}/${resultName}`);
    },
  });
};
