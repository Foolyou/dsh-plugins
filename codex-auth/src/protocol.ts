export const API_PATH = '/api/dsh-codex-auth';
export const CREDENTIAL_KEY = 'llm-pi-ai/openai-codex';
export type LoginMode = 'browser' | 'device_code';
export interface Notice { message: string; url?: string; code?: string }
export interface Prompt {
  id: string; kind: 'text' | 'secret' | 'select'; message: string; placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
}
export type AttemptStatus = 'running' | 'authorized' | 'cancelled' | 'failed';
export interface AuthState {
  available: boolean;
  credential: { present: boolean; expiresAt?: number };
  busyElsewhere: boolean;
  attempt: null | { id: string; status: AttemptStatus; notices: Notice[]; prompt: Prompt | null; error: string | null };
}
export type Action =
  | { action: 'start'; mode: LoginMode }
  | { action: 'answer'; attemptId: string; promptId: string; value: string }
  | { action: 'cancel'; attemptId: string }
  | { action: 'logout' };
