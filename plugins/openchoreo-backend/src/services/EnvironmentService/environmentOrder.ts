/**
 * Deployment-pipeline environment ordering shared by the deploy views
 * (components, projects, resources and endpoints).
 */

/**
 * Extracts the environment name from a sourceEnvironmentRef which may be
 * a plain string (old API) or an object { kind, name } (new API).
 */
export function getSourceEnvName(ref: unknown): string {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && 'name' in ref) {
    return (ref as { name: string }).name;
  }
  return '';
}

/**
 * Orders the environments of a deployment pipeline: topologically along the
 * promotion paths, then Development -> Staging -> Production among
 * environments at the same level, then alphabetically. `envNameMap` maps a
 * lower-cased environment name to the display name to return.
 */
export function getEnvironmentOrder(
  promotionPaths: any[],
  envNameMap: Map<string, string>,
): string[] {
  // Build a proper dependency graph
  const graph = new Map<string, Set<string>>();
  const allEnvs = new Set<string>();

  // Initialize graph and collect all environments
  for (const path of promotionPaths) {
    const sourceRef = getSourceEnvName(path.sourceEnvironmentRef);
    const source = envNameMap.get(sourceRef.toLowerCase()) || sourceRef;
    allEnvs.add(source);

    if (!graph.has(source)) {
      graph.set(source, new Set());
    }

    for (const target of path.targetEnvironmentRefs) {
      const targetName =
        envNameMap.get(target.name.toLowerCase()) || target.name;
      allEnvs.add(targetName);
      graph.get(source)!.add(targetName);
    }
  }

  // Kahn's algorithm for topological sort
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: string[] = [];

  // Initialize in-degrees
  for (const env of allEnvs) {
    inDegree.set(env, 0);
  }

  // Calculate in-degrees
  for (const [_, targets] of graph) {
    for (const target of targets) {
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }
  }

  // Find nodes with no incoming edges
  for (const [env, degree] of inDegree) {
    if (degree === 0) {
      queue.push(env);
    }
  }

  // Process queue
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const neighbors = graph.get(current) || new Set();
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If we have a specific order preference for environments with same level, apply it
  // This ensures Development -> Staging -> Production order when they're at the same level
  const preferredOrder = ['Development', 'Staging', 'Production'];

  // Group environments by their level in the DAG
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  const calculateLevel = (env: string, level: number = 0): number => {
    if (visited.has(env)) return levels.get(env) || 0;
    visited.add(env);
    levels.set(env, level);

    const neighbors = graph.get(env) || new Set();
    for (const neighbor of neighbors) {
      calculateLevel(neighbor, level + 1);
    }
    return level;
  };

  // Calculate levels for all environments
  for (const env of result) {
    if (!visited.has(env)) {
      calculateLevel(env);
    }
  }

  // Sort by level first, then by preferred order
  result.sort((a, b) => {
    const levelA = levels.get(a) || 0;
    const levelB = levels.get(b) || 0;

    if (levelA !== levelB) {
      return levelA - levelB;
    }

    // Same level, use preferred order
    const indexA = preferredOrder.indexOf(a);
    const indexB = preferredOrder.indexOf(b);

    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    return a.localeCompare(b);
  });

  return result;
}
