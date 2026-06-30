import { useRef } from 'react';

/** Always read the latest callback/value from effects without TDZ or stale deps. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
