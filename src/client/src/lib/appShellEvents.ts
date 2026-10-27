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
