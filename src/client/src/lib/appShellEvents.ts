const OPEN_ENVIRONMENT_EVENT = "lios:open-environment-center";

export function openEnvironmentCenter(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_ENVIRONMENT_EVENT));
}

export function subscribeOpenEnvironmentCenter(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_ENVIRONMENT_EVENT, listener);
  return () => window.removeEventListener(OPEN_ENVIRONMENT_EVENT, listener);
}

const OPEN_PLUGIN_CENTER_EVENT = "lios:open-plugin-center";

export function openPluginCenter(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_PLUGIN_CENTER_EVENT));
}

export function subscribeOpenPluginCenter(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_PLUGIN_CENTER_EVENT, listener);
  return () => window.removeEventListener(OPEN_PLUGIN_CENTER_EVENT, listener);
}

/** Direct a user-initiated chat recovery to an existing connector setup form.
 * This is navigation only: it does not grant access, save credentials or run tools. */
const OPEN_GUIDED_CONNECTOR_EVENT = "lios:open-guided-connector";

export function openGuidedConnectorSetup(connectorId: string): void {
  if (typeof window === "undefined" || !/^[a-z][a-z0-9_-]{0,119}$/.test(connectorId)) return;
  window.dispatchEvent(new CustomEvent(OPEN_GUIDED_CONNECTOR_EVENT, { detail: { connectorId } }));
}

export function subscribeOpenGuidedConnectorSetup(listener: (connectorId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const id: unknown = (event as CustomEvent<{ connectorId?: unknown }>).detail?.connectorId;
    if (typeof id === "string" && /^[a-z][a-z0-9_-]{0,119}$/.test(id)) listener(id);
  };
  window.addEventListener(OPEN_GUIDED_CONNECTOR_EVENT, handler);
  return () => window.removeEventListener(OPEN_GUIDED_CONNECTOR_EVENT, handler);
}
