#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build a React-based web app that acts as a frontend interface for controlling Ziggy, an AI-powered smart home assistant. 
  
  The web app must include the following functional pages:
  1. Task Manager Page - Add, view, complete, delete tasks with priority and due dates
  2. Memory Manager Page - Store, retrieve, and delete key-value memories  
  3. Smart Home Dashboard - Control lights, AC, TV, view sensors
  4. Notes & File Manager - Create and read notes
  5. System Control Panel - System info, restart/shutdown Ziggy
  6. Clock & Date Tools - Display current time and date
  7. Ziggy Chatbot Panel - Free-form chat with GPT integration
  
  All intent calls should follow the schema: POST /intent with {"intent": "name", "params": {...}, "source": "web_app"}
  
  Based on Ziggy_PC repository analysis, the supported intents include:
  - Smart Home: toggle_light, set_light_color, set_light_brightness, control_ac, set_ac_temperature, control_tv, set_tv_source, get_temperature, get_humidity
  - Tasks: add_task, list_tasks, remove_task, remove_tasks, remove_last_task, mark_task_done  
  - Memory: remember_memory, recall_memory, delete_memory
  - System: get_time, get_date, get_system_status, get_ip_address, get_disk_usage, get_wifi_status, get_network_adapters, ping_test, restart_ziggy, shutdown_ziggy
  - Chat: chat_with_gpt, ziggy_status, ziggy_identity, ziggy_help

backend:
  - task: "Create Ziggy API Proxy Endpoints"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Need to implement FastAPI endpoints that proxy to Ziggy instance or provide functionality directly"

  - task: "Implement Task Management API"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "API endpoints for add_task, list_tasks, remove_task, mark_task_done with MongoDB storage"

  - task: "Implement Memory Management API"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "API endpoints for remember_memory, recall_memory, delete_memory with MongoDB storage"

  - task: "Implement Smart Home Control API"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "API endpoints for light/AC/TV controls, may need Home Assistant integration"

  - task: "Implement System Tools API"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "API endpoints for system status, time, network info"

  - task: "Implement Chat/GPT Integration API"
    implemented: false
    working: "NA"
    file: "server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "API endpoint for chat_with_gpt with context awareness"

frontend:
  - task: "Create Task Manager Page"
    implemented: false
    working: "NA"
    file: "src/pages/TaskManager.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Task CRUD interface with priority, due dates, status management"

  - task: "Create Memory Manager Page"
    implemented: false
    working: "NA"
    file: "src/pages/MemoryManager.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Key-value memory storage interface"

  - task: "Create Smart Home Dashboard"
    implemented: false
    working: "NA"
    file: "src/pages/SmartHomeDashboard.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Light controls, AC/TV controls, sensor status display"

  - task: "Create System Control Panel"
    implemented: false
    working: "NA"
    file: "src/pages/SystemControl.jsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "System info cards, restart/shutdown buttons, network tools"

  - task: "Create Ziggy Chat Panel"
    implemented: false
    working: "NA"
    file: "src/pages/ChatPanel.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Chat interface with GPT integration and context awareness"

  - task: "Create Main Navigation & Layout"
    implemented: false
    working: "NA"
    file: "src/components/Layout.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Navigation between pages, responsive layout, Ziggy branding"

  - task: "Create Notes & File Manager"
    implemented: false
    working: "NA"
    file: "src/pages/NotesManager.jsx"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Note creation and reading interface"

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 0
  run_ui: false

test_plan:
  current_focus:
    - "Create Ziggy API Proxy Endpoints"
    - "Implement Task Management API"
    - "Create Main Navigation & Layout"
  stuck_tasks: []
  test_all: false  
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "Analyzed Ziggy_PC repository and identified all 25+ supported intents. Ready to build comprehensive web interface with FastAPI backend proxy and React frontend covering all major functionality areas."