declare module "jest-axe" {
  import type { AxeResults } from "axe-core";

  export function axe(
    html: Element | Document | string,
    options?: Record<string, unknown>
  ): Promise<AxeResults>;

  export function toHaveNoViolations(results: AxeResults): {
    pass: boolean;
    message: () => string;
  };
}

declare namespace jest {
  interface Matchers<R> {
    toHaveNoViolations(): R;
  }
}
