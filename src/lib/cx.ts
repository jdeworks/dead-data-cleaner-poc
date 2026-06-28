// Tiny classnames joiner — keeps the primitives free of a runtime dep.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
