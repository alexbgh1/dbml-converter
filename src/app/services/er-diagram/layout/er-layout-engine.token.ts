import { InjectionToken } from '@angular/core';

import { runElkLayout } from './elk-layout-runner';
import type { ErLayoutRunner } from './er-layout-controller';

/** Engine boundary overridden by component tests without importing ELK there. */
export const ER_LAYOUT_ENGINE = new InjectionToken<ErLayoutRunner>(
  'ER_LAYOUT_ENGINE',
  {
    providedIn: 'root',
    factory: () => runElkLayout,
  },
);
