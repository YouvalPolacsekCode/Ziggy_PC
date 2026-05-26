/**
 * Shared nav-dispatch helpers used by both TVRemote and MediaTransportRemote.
 *
 * The 4-layer resolution for nav commands (back / home / menu / d-pad
 * arrows / OK):
 *
 *   1. HA media_player native service        (commandAvailable in lib/devices)
 *   2. Linked IR codeset                     (same — commandAvailable falls
 *                                             through to IR for hybrid devices)
 *   3. Paired remote.* entity                (usePairedRemoteEntityId here +
 *                                             remote.send_command)
 *   4. Vendor adapter                        (vendorSupports / fireViaVendor
 *                                             in mediaPlayerVendors.js)
 *
 * Originally lived inline in TVRemote. Pulled out so MediaTransportRemote
 * (and any future remote component) can reuse the same dispatcher without
 * copy-pasting.
 */

import { useContext } from 'react'
import { useDeviceStore } from '../stores/deviceStore'
import { commandAvailable } from './devices'
import { vendorSupports, fireViaVendor } from './mediaPlayerVendors'
import { callHaService } from './api'


// Look up a HA `remote.*` entity paired with this media_player. Apple TV,
// Android TV, Roku, LG webOS, Samsung Tizen, Fire TV — all expose a
// matching remote entity that accepts `remote.send_command` over WiFi.
//
// Resolution order (most → least authoritative):
//   1. `entity._group.capabilities.companion_remote_entity_id` — backend
//      already picked the sibling via HA's identifiers/connections graph
//      (see services/device_groups._project_capabilities). This is the
//      cross-integration-merge result and survives renamed entity ids.
//   2. Basename match — same string after the dot. Fallback for solo
//      entities (no group), or installs where the device_registry can't
//      merge the integrations (e.g. unique_ids on different keys).
export function usePairedRemoteEntityId(entity) {
  const entities = useDeviceStore(s => s.entities)
  const companion = entity?._group?.capabilities?.companion_remote_entity_id
  if (companion) return companion
  if (!entity?.entity_id?.startsWith('media_player.')) return null
  const basename = entity.entity_id.slice('media_player.'.length)
  const candidate = `remote.${basename}`
  const found = entities.find(e => e.entity_id === candidate)
  return found ? candidate : null
}


// Common command-name remaps between Ziggy's vocabulary and HA's
// `remote.send_command` convention. Most are the same; a few standardise to
// HA-remote semantics (up/down/left/right, select instead of ok).
const _REMOTE_CMD_REMAP = {
  back:      'back',
  home:      'home',
  menu:      'menu',
  nav_up:    'up',
  nav_down:  'down',
  nav_left:  'left',
  nav_right: 'right',
  nav_ok:    'select',
  exit:      'exit',
  info:      'info',
}


export async function fireViaPairedRemote(remoteEntityId, ziggyCmd, addToast) {
  const remoteCmd = _REMOTE_CMD_REMAP[ziggyCmd] || ziggyCmd
  try {
    await callHaService('remote', 'send_command', {
      entity_id: remoteEntityId,
      command: remoteCmd,
    })
  } catch (e) {
    addToast?.(e?.message || `${ziggyCmd} failed`, 'error')
  }
}


/**
 * Build the 4-layer dispatcher closure for one entity. Used by NavRow,
 * DPad, NumPad, and the MediaTransport d-pad — all share the same
 * resolution order.
 *
 * `fire` is the regular sendDeviceCommand wrapper; we call it first when
 * the command has a HA-native or IR path. Otherwise we route through the
 * paired remote.* or the vendor adapter.
 */
export function makeFireSmart({ entity, fire, pairedRemoteId, addToast }) {
  return (cmd) => {
    if (commandAvailable(entity, cmd)) return fire(cmd)
    if (pairedRemoteId)               return fireViaPairedRemote(pairedRemoteId, cmd, addToast)
    if (vendorSupports(entity, cmd))  return fireViaVendor(entity, cmd, callHaService).catch(e => addToast?.(e?.message || `${cmd} failed`, 'error'))
  }
}


/**
 * "Can this command fire over ANY available channel?" — the canonical
 * enabled-check for nav buttons. Used to decide whether to render a
 * button (true) or skip it (false).
 */
export function navAvailable(entity, pairedRemoteId, cmd) {
  return commandAvailable(entity, cmd)
      || !!pairedRemoteId
      || vendorSupports(entity, cmd)
}
