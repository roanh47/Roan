import { isLoopbackAddress, isTailnetAddress } from "./control-http.js";

/**
 * Who may reach a device's UI and control socket from outside the app.
 *
 * The switch is a setting like any other, so it is synced: `deviceOnly` in
 * the config holds on every device of the chain. Off (the default), a device
 * and the tailnet may load the UI and open the socket. On, only the device
 * itself gets in. The app talks to its own daemon over loopback, so it can
 * never lock itself out with this switch.
 *
 * Everything here is pure: the daemon reads the setting and asks.
 */
export interface DeviceAccess {
  readonly deviceOnly: boolean;
}

/**
 * May this address open the control socket? `allowRemote` is the old
 * `ROAN_ALLOW_REMOTE_CONTROL=1` escape; the switch in the app wins over it.
 */
export function mayControl(access: DeviceAccess, address: string | undefined, allowRemote: boolean): boolean {
  if (isLoopbackAddress(address)) return true;
  if (access.deviceOnly) return false;
  return allowRemote || isTailnetAddress(address);
}

/** May this address load the UI and the log over HTTP? */
export function mayLoadUi(access: DeviceAccess, address: string | undefined): boolean {
  return !access.deviceOnly || isLoopbackAddress(address);
}
