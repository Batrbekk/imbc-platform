"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Uses a deadline so switching tabs does not extend a resend cooldown. */
export function useCooldown() {
  const deadline = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const start = useCallback((duration: number) => {
    const value = Math.max(0, Math.ceil(duration));
    deadline.current = Date.now() + value * 1000;
    setSeconds(value);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return { seconds, start };
}
