import { liveQueueDebug } from './liveQueue';

/** Cloud diagnostics intentionally exclude URLs, share IDs, payloads and error messages. */
export function cloudDiagnostic(operation: string, status: string, error?: unknown) {
  const candidate = (error as { code?: unknown } | null)?.code;
  const code = typeof candidate === 'string' && /^[a-zA-Z0-9_/-]{1,80}$/.test(candidate) ? candidate : 'unknown';
  const details = { status, ...(error ? { code } : {}) };
  liveQueueDebug(operation, details);
  if (error || ['not_found', 'expired', 'invalid'].includes(status)) console.warn(`[cloud] ${operation}`, details);
}

export async function cloudOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
  cloudDiagnostic(operation, 'started');
  let timer: ReturnType<typeof setTimeout>;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Cloud request timed out'), { code: 'cloud/timeout' })), 15000);
    });
    const result = await Promise.race([Promise.resolve().then(run), timeout]);
    cloudDiagnostic(operation, 'ok');
    return result;
  } catch (error) {
    cloudDiagnostic(operation, 'failed', error);
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}
