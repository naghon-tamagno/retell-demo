type CallEvent = {
  received_at: string;
  event?: string;
  payload: any;
};

declare global {
  // eslint-disable-next-line no-var
  var __RETELL_CALL_STORE__: Map<string, CallEvent[]> | undefined;
}

export function getStore() {
  if (!global.__RETELL_CALL_STORE__) {
    global.__RETELL_CALL_STORE__ = new Map<string, CallEvent[]>();
  }
  return global.__RETELL_CALL_STORE__;
}

export function appendCallEvent(callId: string, evt: CallEvent) {
  const store = getStore();
  const arr = store.get(callId) ?? [];
  arr.push(evt);
  store.set(callId, arr);
}

export function getCallEvents(callId: string) {
  const store = getStore();
  return store.get(callId) ?? [];
}