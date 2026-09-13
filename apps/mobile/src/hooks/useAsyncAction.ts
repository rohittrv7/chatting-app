import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseAsyncActionOptions<TReturn> {
  onSuccess?: (result: TReturn) => void;
  onError?: (error: any) => void;
}

export function useAsyncAction<TArgs extends any[] = any[], TReturn = any>(
  actionFn: (...args: TArgs) => Promise<TReturn>,
  options: UseAsyncActionOptions<TReturn> = {},
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: TArgs): Promise<TReturn | undefined> => {
      if (inFlightRef.current) {
        return undefined;
      }

      inFlightRef.current = true;
      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        const result = await actionFn(...args);
        if (isMountedRef.current) {
          setLoading(false);
        }
        inFlightRef.current = false;
        options.onSuccess?.(result);
        return result;
      } catch (err: any) {
        if (isMountedRef.current) {
          setError(err);
          setLoading(false);
        }
        inFlightRef.current = false;
        options.onError?.(err);
        return undefined;
      }
    },
    [actionFn, options],
  );

  const reset = useCallback(() => {
    inFlightRef.current = false;
    if (isMountedRef.current) {
      setLoading(false);
      setError(null);
    }
  }, []);

  return {
    loading,
    error,
    execute,
    reset,
  };
}
