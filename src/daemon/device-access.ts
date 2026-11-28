import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLoopbackAddress, isTailnetAddress } from "./control-http.js";

/**
 * Who may reach this device's UI and control socket from outside the app.
 *
 * This is one of the few settings that does not travel with the chain, and
 * the reason is physical: it describes this machine's own listener. A phone
 * that closes itself must not close the server's web UI along with it. So it
 * lives in `state/`, which the env packer never reads.
 *
 * `deviceOnly` off (the default) keeps the UI reachable from this device and
 * from the tailnet. On, only this device itself gets in. The app talks to its
 * daemon over loopback, so it can never lock itself out with this switch.
 */
export interface DeviceAccess {
  readonly deviceOnly: boolean;
}

export const OPEN_ACCESS: DeviceAccess = { deviceOnly: false };

function accessFile(stateDir: string): string {
  return join(stateDir, "access.json");
}

/** Only a literal `true` closes the device; a missing or broken file is open. */
export async function loadDeviceAccess(stateDir: string): Promise<DeviceAccess> {
  try {
    const parsed: unknown = JSON.parse(await readFile(accessFile(stateDir), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return OPEN_ACCESS;
    return { deviceOnly: (parsed as Record<string, unknown>)["deviceOnly"] === true };
  } catch {
    return OPEN_ACCESS;
  }
}

export async function saveDeviceAccess(stateDir: string, access: DeviceAccess): Promise<DeviceAccess> {
  const clean: DeviceAccess = { deviceOnly: access.deviceOnly === true };
  await mkdir(stateDir, { recursive: true });
  await writeFile(accessFile(stateDir), `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return clean;
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
