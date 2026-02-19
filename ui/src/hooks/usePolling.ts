import { useEffect, useRef } from 'react';

interface UsePollingOptions {
  /** Function to check if the condition is met */
  checkFn: () => Promise<boolean>;
  /** Interval in milliseconds between checks */
  interval?: number;
  /** Maximum number of attempts before giving up */
  maxAttempts?: number;
  /** Callback when condition is met */
  onSuccess?: () => void;
  /** Callback when max attempts reached */
  onTimeout?: () => void;
  /** Whether polling is enabled */
  enabled?: boolean;
}

/**
 * Hook to poll a condition until it's met or timeout.
 * Useful for checking async operations like file processing.
 */
export function usePolling({
  checkFn,
  interval = 2000,
  maxAttempts = 30, // 30 attempts * 2s = 60 seconds max
  onSuccess,
  onTimeout,
  enabled = true,
}: UsePollingOptions) {
  const attemptsRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      attemptsRef.current = 0;
      return;
    }

    attemptsRef.current = 0;

    const poll = async () => {
      if (attemptsRef.current >= maxAttempts) {
        onTimeout?.();
        return;
      }

      attemptsRef.current += 1;

      try {
        const result = await checkFn();
        if (result) {
          onSuccess?.();
        } else {
          timeoutRef.current = setTimeout(poll, interval);
        }
      } catch (error) {
        // On error, continue polling (might be transient)
        console.warn('Polling error:', error);
        timeoutRef.current = setTimeout(poll, interval);
      }
    };

    // Start polling immediately
    poll();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, checkFn, interval, maxAttempts, onSuccess, onTimeout]);
}
