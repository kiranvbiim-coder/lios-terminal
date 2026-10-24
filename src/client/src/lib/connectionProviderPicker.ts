/** Read-only discovery helpers. Never infer live verification from a saved
 * configuration, and never grant a catalog-only provider a connection action. */
export interface ProviderPickerOption {
  id: string;
  name: string;
  description?: string;
  category: string;
  adapterImplemented?: boolean;
}

export function chooseConnectionProviders<T extends ProviderPickerOption>(
  catalog: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return catalog.filter(provider => !needle || [
    provider.name, provider.description ?? "", provider.category,
  ].some(value => value.toLocaleLowerCase().includes(needle)));
}

export function connectionPickerStatus(
  provider: Pick<ProviderPickerOption, "adapterImplemented">,
  saved: boolean,
): { canSelect: boolean; label: string } {
  if (provider.adapterImplemented === false) {
    return { canSelect: false, label: "Catalog only · adapter unavailable" };
  }
  if (saved) {
    return { canSelect: true, label: "Saved configuration · review verification separately" };
  }
  return { canSelect: true, label: "Available to configure · not yet connected" };
}

/** Closing the center to return to the already-mounted workbench is not a
 * setup mutation. The explicit save-and-continue button has separate logic. */
export function returnFromConnectionCenter(onReturn: () => void): void {
  onReturn();
}
