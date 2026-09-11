// Structural view of the installed DSH ModelDirectory contract. IDs are opaque.
export interface Selection { provider: string; model: string; reasoningEffort?: string }
export interface Reasoning { defaultEffort?: string; efforts: readonly { id: string; name: string }[] }
export interface Model { id: string; name: string; reasoning?: Reasoning }
export interface DirectoryState {
  current: Selection | null;
  groups: readonly { id: string; name: string; models: readonly Model[] }[];
  failures: readonly { id: string; name: string; message: string }[];
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
  error: string | null;
}
export interface Directory {
  store: { subscribe(fn: () => void): () => void; getSnapshot(): DirectoryState };
  load(): Promise<unknown>;
  select(selection: Selection): Promise<void>;
}
export interface EffortChoice { id: string; label: string; effort?: string }
export function effortChoices(reasoning?: Reasoning): EffortChoice[] {
  if (!reasoning) return [];
  return [
    ...(reasoning.defaultEffort === undefined ? [{ id: 'provider-default', label: 'Default' }] : []),
    ...reasoning.efforts.map(e => ({ id: `effort:${e.id}`, label: e.name, effort: e.id })),
  ];
}
export function activeChoice(current: Selection | null, reasoning?: Reasoning) {
  const effective = current?.reasoningEffort ?? reasoning?.defaultEffort;
  return effortChoices(reasoning).find(e => e.effort === effective);
}
export function selectEffort(current: Selection, choice: EffortChoice): Selection {
  return { provider: current.provider, model: current.model,
    ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }) };
}
export function selectModel(provider: string, model: Model, current: Selection | null): Selection {
  const effort = current?.provider === provider && current.model === model.id
    ? current.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort;
  return { provider, model: model.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
}
