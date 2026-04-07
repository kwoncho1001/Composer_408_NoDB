import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { OperationType, FirestoreErrorInfo } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function computeHash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'local-guest',
      email: 'guest@local',
      emailVerified: false,
      isAnonymous: true,
      tenantId: '',
      providerInfo: []
    },
    operationType,
    path
  }
  console.error('Local Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: any): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`Promise timed out after ${ms}ms`);
      resolve(fallback);
    }, ms);
  });

  return Promise.race([
    promise.then((res) => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise
  ]);
}

export function removeUndefined<T extends Record<string, any>>(obj: T): T {
  const newObj = { ...obj };
  Object.keys(newObj).forEach(key => {
    if (newObj[key] === undefined) {
      delete newObj[key];
    }
  });
  return newObj;
}
