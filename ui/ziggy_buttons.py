from telegram import InlineKeyboardButton, InlineKeyboardMarkup

# === MAIN MENU ===
def get_main_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📅 Tasks", callback_data="menu_tasks")],
        [InlineKeyboardButton("💡 Home Automation", callback_data="menu_home")],
        [InlineKeyboardButton("🛠 System Tools", callback_data="menu_system")],
        [InlineKeyboardButton("🧠 Memory", callback_data="menu_memory")],
        [InlineKeyboardButton("🤖 Ziggy Core", callback_data="menu_core")],
        [InlineKeyboardButton("🕐 Date & Time", callback_data="menu_datetime")]
    ])

# === TASK MENU ===
def get_task_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Add Task", callback_data="add_task")],
        [InlineKeyboardButton("📋 List Tasks", callback_data="list_tasks")],
        [InlineKeyboardButton("✅ Mark Done", callback_data="mark_task_done")],
        [InlineKeyboardButton("🗑 Remove Task", callback_data="remove_task")],
        [InlineKeyboardButton("❌ Remove All Tasks", callback_data="remove_tasks")],
        [InlineKeyboardButton("🗑 Remove Last Task", callback_data="remove_last_task")],
        [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
    ])

# === HOME MENU ===
def get_home_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💡 Lights", callback_data="menu_lights")],
        [InlineKeyboardButton("❄️ AC Control", callback_data="menu_ac")],
        [InlineKeyboardButton("📺 TV Control", callback_data="menu_tv")],
        [InlineKeyboardButton("🌡️ Sensors", callback_data="menu_sensors")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

# === LIGHTS MENU ===
def get_lights_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💡 Toggle Light", callback_data="toggle_light")],
        [InlineKeyboardButton("🎨 Set Light Color", callback_data="set_light_color")],
        [InlineKeyboardButton("🔆 Adjust Brightness", callback_data="adjust_light_brightness")],
        [InlineKeyboardButton("⬅️ Back", callback_data="menu_home")]
    ])

# === AC MENU ===
def get_ac_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("❄️ Toggle AC", callback_data="control_ac")],
        [InlineKeyboardButton("🌡️ Set Temperature", callback_data="set_ac_temperature")],
        [InlineKeyboardButton("⬅️ Back", callback_data="menu_home")]
    ])

# === TV MENU ===
def get_tv_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📺 Toggle TV", callback_data="control_tv")],
        [InlineKeyboardButton("📡 Set TV Source", callback_data="set_tv_source")],
        [InlineKeyboardButton("⬅️ Back", callback_data="menu_home")]
    ])

# === SENSOR MENU ===
def get_sensors_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🌡️ Get Temperature", callback_data="get_temperature")],
        [InlineKeyboardButton("💧 Get Humidity", callback_data="get_humidity")],
        [InlineKeyboardButton("⬅️ Back", callback_data="menu_home")]
    ])

# === SYSTEM MENU ===
def get_system_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 System Status", callback_data="get_system_status")],
        [InlineKeyboardButton("📶 WiFi Status", callback_data="get_wifi_status")],
        [InlineKeyboardButton("💻 IP Address", callback_data="get_ip_address")],
        [InlineKeyboardButton("💾 Disk Usage", callback_data="get_disk_usage")],
        [InlineKeyboardButton("🌐 Network Adapters", callback_data="get_network_adapters")],
        [InlineKeyboardButton("📡 Ping Test", callback_data="ping_test")],
        [InlineKeyboardButton("🔄 Restart Ziggy", callback_data="restart_ziggy")],
        [InlineKeyboardButton("🛑 Shutdown Ziggy", callback_data="shutdown_ziggy")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

# === MEMORY MENU ===
def get_memory_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💾 Remember Something", callback_data="remember_memory")],
        [InlineKeyboardButton("📤 Recall Memory", callback_data="recall_memory")],
        [InlineKeyboardButton("🗑️ Delete Memory", callback_data="delete_memory")],
        [InlineKeyboardButton("📋 List All Memory", callback_data="list_memory")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

# === CORE MENU ===
def get_core_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💬 Chat with GPT", callback_data="chat_with_gpt")],
        [InlineKeyboardButton("❔ Who are you?", callback_data="ziggy_identity")],
        [InlineKeyboardButton("📖 Help", callback_data="ziggy_help")],
        [InlineKeyboardButton("😊 Ziggy Status", callback_data="ziggy_status")],
        [InlineKeyboardButton("🎲 Fun Facts", callback_data="ziggy_chat")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

# === DATE & TIME MENU ===
def get_datetime_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🕐 Current Time", callback_data="get_time")],
        [InlineKeyboardButton("📅 Current Date", callback_data="get_date")],
        [InlineKeyboardButton("📆 Day of Week", callback_data="get_day_of_week")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

# === HELPER: ROOM SELECTION ===
def get_room_selection_menu(action_type):
    rooms = ["living_room", "bedroom", "kitchen", "bathroom", "office"]
    keyboard = []
    for room in rooms:
        display = room.replace("_", " ").title()
        keyboard.append([InlineKeyboardButton(f"🏠 {display}", callback_data=f"{action_type}_{room}")])
    keyboard.append([InlineKeyboardButton("⬅️ Back", callback_data="menu_home")])
    return InlineKeyboardMarkup(keyboard)

# === HELPER: COLOR SELECTION ===
def get_color_selection_menu():
    colors = [
        ("🔴 Red", "color_red"),
        ("🟢 Green", "color_green"),
        ("🔵 Blue", "color_blue"),
        ("🟡 Yellow", "color_yellow"),
        ("⚪ White", "color_white"),
        ("🟠 Orange", "color_orange"),
        ("🟣 Purple", "color_purple"),
        ("🩷 Pink", "color_pink")
    ]
    keyboard = [[InlineKeyboardButton(label, callback_data=data)] for label, data in colors]
    keyboard.append([InlineKeyboardButton("⬅️ Back", callback_data="menu_lights")])
    return InlineKeyboardMarkup(keyboard)

# === HELPER: PRIORITY MENU ===
def get_priority_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔴 High Priority", callback_data="priority_high")],
        [InlineKeyboardButton("🟡 Medium Priority", callback_data="priority_medium")],
        [InlineKeyboardButton("🟢 Low Priority", callback_data="priority_low")],
        [InlineKeyboardButton("⬅️ Back", callback_data="menu_tasks")]
    ])
