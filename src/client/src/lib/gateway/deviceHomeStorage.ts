import {
  deviceHomesStateSchema,
  EMPTY_DEVICE_HOMES_STATE,
  recordFromPairingInvitation,
  removeDeviceHome,
  setActiveDeviceHome,
  upsertDeviceHome,
  type DeviceHomeRecord,
  type DeviceHomesState,
} from "@shared/deviceHomes";
import { decodeDevicePairingInvitation } from "@shared/deviceNetwork";

const STORAGE_KEY = "lios-device-homes-v1";

function localStore(): Storage | null {
  return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
}

export function readDeviceHomesState(): DeviceHomesState {
  const storage = localStore();
  if (!storage) return EMPTY_DEVICE_HOMES_STATE;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DEVICE_HOMES_STATE;
    return deviceHomesStateSchema.parse(JSON.parse(raw));
  } catch {
    return EMPTY_DEVICE_HOMES_STATE;
  }
}

export function writeDeviceHomesState(state: DeviceHomesState): DeviceHomesState {
  const parsed = deviceHomesStateSchema.parse(state);
  localStore()?.setItem(STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

/** Validates a pasted pairing invitation (scheme, size, expiry) and remembers only the Home's public identity, never the pairing token. */
export function rememberPairingInvitationUri(uri: string): DeviceHomesState {
  const record = recordFromPairingInvitation(decodeDevicePairingInvitation(uri.trim()));
  return writeDeviceHomesState(upsertDeviceHome(readDeviceHomesState(), record));
}

export function forgetDeviceHome(homeId: string): DeviceHomesState {
  return writeDeviceHomesState(removeDeviceHome(readDeviceHomesState(), homeId));
}

export function chooseActiveDeviceHome(homeId: string): DeviceHomesState {
  return writeDeviceHomesState(setActiveDeviceHome(readDeviceHomesState(), homeId));
}

export function listDeviceHomes(): DeviceHomeRecord[] {
  return readDeviceHomesState().homes;
}
