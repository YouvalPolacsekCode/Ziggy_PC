from telegram import InlineKeyboardButton, InlineKeyboardMarkup

def get_main_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📅 Tasks", callback_data="menu_tasks")],
        [InlineKeyboardButton("💡 Home Automation", callback_data="menu_home")],
        [InlineKeyboardButton("🛠 System", callback_data="menu_system")],
        [InlineKeyboardButton("🧠 Memory", callback_data="menu_memory")],
        [InlineKeyboardButton("🤖 Ziggy Core", callback_data="menu_core")]
    ])

def get_task_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Add Task", callback_data="add_task")],
        [InlineKeyboardButton("📋 List Tasks", callback_data="list_tasks")],
        [InlineKeyboardButton("🗑 Remove Task", callback_data="remove_task")],
        [InlineKeyboardButton("❌ Remove All", callback_data="remove_tasks")],
        [InlineKeyboardButton("🔙 Back", callback_data="main_menu")]
    ])

def get_home_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💡 Toggle Light", callback_data="toggle_light")],
        [InlineKeyboardButton("🎨 Set Light Color", callback_data="set_light_color")],
        [InlineKeyboardButton("📺 Control TV", callback_data="control_tv")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

def get_system_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📶 WiFi Status", callback_data="get_wifi_status")],
        [InlineKeyboardButton("🔄 Restart Ziggy", callback_data="restart_ziggy")],
        [InlineKeyboardButton("💻 IP Address", callback_data="get_ip_address")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

def get_memory_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💾 Remember", callback_data="remember_memory")],
        [InlineKeyboardButton("📤 Recall", callback_data="recall_memory")],
        [InlineKeyboardButton("❌ Delete", callback_data="delete_memory")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])

def get_core_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🧠 Chat", callback_data="chat_with_gpt")],
        [InlineKeyboardButton("❔ Who are you?", callback_data="ziggy_identity")],
        [InlineKeyboardButton("📖 Help", callback_data="ziggy_help")],
        [InlineKeyboardButton("⬅️ Back", callback_data="main_menu")]
    ])
