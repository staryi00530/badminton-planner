import * as domMatchers from '@testing-library/jest-dom/matchers';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Register DOM matchers against Vitest 5's two-parameter Assertion interface.
// jest-dom's /vitest declaration still targets the older one-parameter interface.
type DomAssertions<R> = {
  [K in 'toBeInTheDocument' | 'toBeVisible' | 'toBeDisabled' | 'toBeEnabled' | 'toHaveTextContent' | 'toHaveAttribute' | 'toHaveValue' | 'toHaveStyle' | 'toHaveClass' | 'toBeChecked' | 'toHaveFocus' | 'toHaveAccessibleName']: (...args: Parameters<typeof domMatchers[K]> extends [unknown, ...infer Rest] ? Rest : never) => R;
};
declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> extends DomAssertions<R> {}
  interface AsymmetricMatchersContaining extends DomAssertions<unknown> {}
}
expect.extend(domMatchers);
// Most fixtures exercise the default storage contract; beta isolation has dedicated tests.
beforeEach(() => vi.stubEnv('VITE_BETA', 'false'));

// The algorithm/util test files run in the (faster) 'node' environment with no DOM at
// all, so only unmount React trees between tests when one was actually rendered.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  vi.unstubAllEnvs();
});
