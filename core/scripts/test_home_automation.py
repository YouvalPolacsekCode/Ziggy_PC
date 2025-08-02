import sys, os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from services.home_automation import toggle_light, set_light_color

ENTITY_ID = "light.kitchen_light"

print("Turning ON the light...")
toggle_light(ENTITY_ID, True)

print("Setting warm yellow (color_temp=370)...")
set_light_color(ENTITY_ID, color_temp=370)

print("Setting green RGB...")
set_light_color(ENTITY_ID, rgb_color=(0, 255, 0))

print("Turning OFF the light...")
toggle_light(ENTITY_ID, False)
