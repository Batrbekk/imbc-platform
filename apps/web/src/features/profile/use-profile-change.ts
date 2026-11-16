import { useCallback, useLayoutEffect, useRef } from "react";

/** Sibling async controls can settle in one React batch. Every patch sees preceding patches immediately. */
export function useProfileChange<T>(value: T, onChange: (next: T) => void) {
  const current = useRef(value);
  useLayoutEffect(() => { current.current = value; }, [value]);
  return useCallback((patch: (previous: T) => T) => {
    const next = patch(current.current);
    current.current = next;
    onChange(next);
  }, [onChange]);
}
