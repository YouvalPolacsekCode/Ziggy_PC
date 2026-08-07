// type → component. Kept separate from registry.js so the manifests stay
// importable by the store without dragging React components (and therefore
// the store itself) into an import cycle.
//
// Adding a module: one manifest in registry.js, one entry here.

import { ShoppingModule, AgendaModule } from './ListModules'
import {
  ZiggyModule, ScenesModule, PinnedModule, RoomModule,
  ClockModule, WeatherModule, TasksModule, AlertsModule, ModesModule,
} from './CoreModules'
import { CameraModule, MediaModule } from './MediaModules'

export const MODULE_COMPONENTS = {
  ziggy:    ZiggyModule,
  agenda:   AgendaModule,
  shopping: ShoppingModule,
  scenes:   ScenesModule,
  pinned:   PinnedModule,
  room:     RoomModule,
  cameras:  CameraModule,
  weather:  WeatherModule,
  tasks:    TasksModule,
  alerts:   AlertsModule,
  media:    MediaModule,
  modes:    ModesModule,
  clock:    ClockModule,
}
