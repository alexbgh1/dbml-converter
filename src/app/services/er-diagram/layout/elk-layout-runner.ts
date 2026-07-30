import { fromElkGraph, toElkGraph } from './elk-layout-adapter';
import type { ErLayoutRunner } from './er-layout-controller';

/**
 * Loader injection deliberately returns `unknown`: ELK's public types stop at
 * this module boundary and cannot leak into the controller or renderer.
 */
export type ElkModuleLoader = () => Promise<unknown>;

interface ElkEngineBoundary {
  layout(graph: unknown): unknown | PromiseLike<unknown>;
}

type ElkEngineConstructor = new () => unknown;

export class ElkLayoutRunnerError extends Error {
  override readonly name = 'ElkLayoutRunnerError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Creates an isolated runner with one lazily initialized ELK engine.
 *
 * Concurrent first calls share the same initialization promise. A failed load
 * or invalid module clears only that promise, allowing a later request to
 * retry. Once initialized, a layout failure does not discard the healthy
 * engine instance.
 */
export function createElkLayoutRunner(
  loader: ElkModuleLoader = loadBundledElkModule,
): ErLayoutRunner {
  let cachedEngine: Promise<ElkEngineBoundary> | undefined;

  const getEngine = (): Promise<ElkEngineBoundary> => {
    if (cachedEngine) {
      return cachedEngine;
    }

    const initialization = Promise.resolve()
      .then(loader)
      .then(instantiateEngine);
    const retryableInitialization = initialization.catch((error: unknown) => {
      if (cachedEngine === retryableInitialization) {
        cachedEngine = undefined;
      }
      throw error;
    });
    cachedEngine = retryableInitialization;
    return retryableInitialization;
  };

  return async (request) => {
    const engine = await getEngine();
    const laidOutGraph = await engine.layout(toElkGraph(request));
    return fromElkGraph(laidOutGraph, request);
  };
}

/** Default application runner. The 1.6 MB ELK bundle is loaded on first use. */
export const runElkLayout: ErLayoutRunner = createElkLayoutRunner();

function loadBundledElkModule(): Promise<unknown> {
  return import('elkjs/lib/elk.bundled.js');
}

function instantiateEngine(moduleValue: unknown): ElkEngineBoundary {
  const Constructor = readConstructor(moduleValue);
  let candidate: unknown;

  try {
    candidate = new Constructor();
  } catch (cause) {
    throw new ElkLayoutRunnerError(
      'The ELK module could not create a layout engine.',
      { cause },
    );
  }

  if (!isRecord(candidate) || typeof candidate['layout'] !== 'function') {
    throw new ElkLayoutRunnerError(
      'The ELK module did not create an engine with a layout function.',
    );
  }

  return {
    layout: candidate['layout'].bind(candidate) as ElkEngineBoundary['layout'],
  };
}

function readConstructor(moduleValue: unknown): ElkEngineConstructor {
  let candidate = moduleValue;

  // Native ESM exposes `default`; some CommonJS interop layers add a second
  // default wrapper. Supporting both keeps this boundary bundler-independent.
  for (let depth = 0; depth < 2; depth += 1) {
    if (!isRecord(candidate) || !('default' in candidate)) {
      break;
    }
    candidate = candidate['default'];
  }

  if (typeof candidate !== 'function') {
    throw new ElkLayoutRunnerError(
      'The loaded ELK module did not expose a constructor.',
    );
  }

  return candidate as ElkEngineConstructor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
