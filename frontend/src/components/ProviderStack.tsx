"use client";

import type { ComponentType, ReactNode } from "react";

// Flattens the deep `<A><B><C>{children}</C></B></A>` provider tower into a
// single `<ProviderStack providers={[A, B, C]}>{children}</ProviderStack>`
// declaration. Order is outermost-first: providers later in the array can
// consume providers earlier in the array.
export function ProviderStack({
  providers,
  children,
}: {
  providers: ComponentType<{ children: ReactNode }>[];
  children: ReactNode;
}) {
  return providers.reduceRight<ReactNode>(
    (tree, Provider) => <Provider>{tree}</Provider>,
    children,
  );
}
