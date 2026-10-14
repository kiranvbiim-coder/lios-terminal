import { DevicePairingService } from "./devicePairingService";
import { gatewayHub, notifyDataChanged } from "./gatewayRuntime";
import { DeviceNetwork } from "./deviceNetwork";

/** The one pairing service of this Home. Changes are announced to the owner's connected UIs (`devices` topic). */
export const devicePairing = new DevicePairingService({
  onChange: (userId) => notifyDataChanged("devices", { userId }),
});

/** A separate TLS-only device listener; off until the Home owner explicitly enables it. */
export const deviceNetwork = new DeviceNetwork({ hub: gatewayHub, authenticator: devicePairing });
