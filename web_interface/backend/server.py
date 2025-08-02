from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import requests
import psutil
import socket
import platform
import subprocess
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Ziggy Web Interface API", version="1.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Ziggy Configuration
ZIGGY_BASE_URL = os.environ.get('ZIGGY_URL', 'http://localhost:5000')  # Default Ziggy URL

# ================================
# Pydantic Models
# ================================

class ZiggyIntent(BaseModel):
    intent: str
    params: Dict[str, Any] = {}
    source: str = "web_app"

class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task: str
    priority: Optional[str] = "medium"  # high, medium, low
    due: Optional[str] = None
    reminder: Optional[str] = None
    notes: Optional[str] = None
    repeat: Optional[str] = None
    completed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    source: str = "web_app"

class TaskCreate(BaseModel):
    task: str
    priority: Optional[str] = "medium"
    due: Optional[str] = None
    reminder: Optional[str] = None
    notes: Optional[str] = None
    repeat: Optional[str] = None

class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str
    value: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class MemoryCreate(BaseModel):
    key: str
    value: str

class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class NoteCreate(BaseModel):
    title: str
    content: str

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # user or assistant
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ChatRequest(BaseModel):
    message: str

class SmartHomeControl(BaseModel):
    room: Optional[str] = None
    action: str
    params: Dict[str, Any] = {}

# ================================
# Helper Functions
# ================================

async def call_ziggy_intent(intent_data: ZiggyIntent) -> Dict[str, Any]:
    """
    Proxy function to call Ziggy's intent endpoint or implement functionality locally
    """
    try:
        # Try to call actual Ziggy instance first
        response = requests.post(
            f"{ZIGGY_BASE_URL}/api/intent",
            json=intent_data.dict(),
            timeout=5
        )
        if response.status_code == 200:
            return response.json()
    except requests.exceptions.RequestException as e:
        logger.warning(f"Could not reach Ziggy instance: {e}")
    
    # Fallback to local implementation for some intents
    return await handle_intent_locally(intent_data)

async def handle_intent_locally(intent_data: ZiggyIntent) -> Dict[str, Any]:
    """
    Local implementation of common intents when Ziggy instance is not available
    """
    intent = intent_data.intent
    params = intent_data.params
    
    if intent == "get_time":
        return {"status": "success", "message": datetime.now().strftime("%H:%M:%S")}
    
    elif intent == "get_date":
        return {"status": "success", "message": datetime.now().strftime("%Y-%m-%d")}
    
    elif intent == "get_system_status":
        cpu_percent = psutil.cpu_percent()
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        return {
            "status": "success",
            "message": f"CPU: {cpu_percent}% | Memory: {memory.percent}% | Disk: {disk.percent}%"
        }
    
    elif intent == "get_ip_address":
        try:
            hostname = socket.gethostname()
            ip_address = socket.gethostbyname(hostname)
            return {"status": "success", "message": f"IP Address: {ip_address}"}
        except Exception as e:
            return {"status": "error", "message": f"Could not get IP: {str(e)}"}
    
    elif intent == "ping_test":
        domain = params.get("domain", "google.com")
        try:
            if platform.system().lower() == "windows":
                result = subprocess.run(["ping", "-n", "1", domain], capture_output=True, text=True)
            else:
                result = subprocess.run(["ping", "-c", "1", domain], capture_output=True, text=True)
            
            if result.returncode == 0:
                return {"status": "success", "message": f"Ping to {domain} successful"}
            else:
                return {"status": "error", "message": f"Ping to {domain} failed"}
        except Exception as e:
            return {"status": "error", "message": f"Ping error: {str(e)}"}
    
    else:
        return {"status": "error", "message": f"Intent '{intent}' not implemented locally"}

# ================================
# API Routes
# ================================

@api_router.get("/")
async def root():
    return {"message": "Ziggy Web Interface API", "version": "1.0.0"}

# ================================
# Intent Proxy Route
# ================================

@api_router.post("/intent")
async def handle_intent(intent_data: ZiggyIntent):
    """
    Proxy route to handle all Ziggy intents
    """
    try:
        result = await call_ziggy_intent(intent_data)
        return result
    except Exception as e:
        logger.error(f"Error handling intent {intent_data.intent}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Task Management Routes
# ================================

@api_router.post("/tasks", response_model=Task)
async def create_task(task_data: TaskCreate):
    """Create a new task"""
    try:
        task_dict = task_data.dict()
        task_obj = Task(**task_dict)
        
        # Store in MongoDB
        await db.tasks.insert_one(task_obj.dict())
        
        # Also try to sync with Ziggy
        try:
            ziggy_intent = ZiggyIntent(
                intent="add_task",
                params=task_dict,
                source="web_app"
            )
            await call_ziggy_intent(ziggy_intent)
        except Exception as e:
            logger.warning(f"Could not sync task with Ziggy: {e}")
        
        return task_obj
    except Exception as e:
        logger.error(f"Error creating task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/tasks", response_model=List[Task])
async def get_tasks():
    """Get all tasks"""
    tasks = await db.tasks.find().to_list(1000)
    return [Task(**task) for task in tasks]

@api_router.put("/tasks/{task_id}/complete")
async def complete_task(task_id: str):
    """Mark task as completed"""
    try:
        result = await db.tasks.update_one(
            {"id": task_id},
            {"$set": {"completed": True}}
        )
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Try to sync with Ziggy
        try:
            ziggy_intent = ZiggyIntent(
                intent="mark_task_done",
                params={"task": task_id},
                source="web_app"
            )
            await call_ziggy_intent(ziggy_intent)
        except Exception as e:
            logger.warning(f"Could not sync with Ziggy: {e}")
        
        return {"status": "success", "message": "Task marked as completed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a specific task"""
    try:
        result = await db.tasks.delete_one({"id": task_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        
        return {"status": "success", "message": "Task deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/tasks")
async def delete_all_tasks():
    """Delete all tasks"""
    try:
        await db.tasks.delete_many({})
        
        # Try to sync with Ziggy
        try:
            ziggy_intent = ZiggyIntent(
                intent="remove_tasks",
                params={},
                source="web_app"
            )
            await call_ziggy_intent(ziggy_intent)
        except Exception as e:
            logger.warning(f"Could not sync with Ziggy: {e}")
        
        return {"status": "success", "message": "All tasks deleted"}
    except Exception as e:
        logger.error(f"Error deleting all tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Memory Management Routes
# ================================

@api_router.post("/memory", response_model=Memory)
async def create_memory(memory_data: MemoryCreate):
    """Store a new memory"""
    try:
        # Check if key already exists and update instead
        existing = await db.memory.find_one({"key": memory_data.key})
        
        if existing:
            # Update existing memory
            await db.memory.update_one(
                {"key": memory_data.key},
                {"$set": {"value": memory_data.value, "updated_at": datetime.utcnow()}}
            )
            updated_memory = await db.memory.find_one({"key": memory_data.key})
            memory_obj = Memory(**updated_memory)
        else:
            # Create new memory
            memory_obj = Memory(**memory_data.dict())
            await db.memory.insert_one(memory_obj.dict())
        
        # Try to sync with Ziggy
        try:
            ziggy_intent = ZiggyIntent(
                intent="remember_memory",
                params={"key": memory_data.key, "value": memory_data.value},
                source="web_app"
            )
            await call_ziggy_intent(ziggy_intent)
        except Exception as e:
            logger.warning(f"Could not sync memory with Ziggy: {e}")
        
        return memory_obj
    except Exception as e:
        logger.error(f"Error creating memory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/memory", response_model=List[Memory])
async def get_memories():
    """Get all stored memories"""
    memories = await db.memory.find().to_list(1000)
    return [Memory(**memory) for memory in memories]

@api_router.get("/memory/{key}")
async def get_memory(key: str):
    """Get specific memory by key"""
    memory = await db.memory.find_one({"key": key})
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    return Memory(**memory)

@api_router.delete("/memory/{key}")
async def delete_memory(key: str):
    """Delete a specific memory"""
    try:
        result = await db.memory.delete_one({"key": key})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Memory not found")
        
        # Try to sync with Ziggy
        try:
            ziggy_intent = ZiggyIntent(
                intent="delete_memory",
                params={"key": key},
                source="web_app"
            )
            await call_ziggy_intent(ziggy_intent)
        except Exception as e:
            logger.warning(f"Could not sync with Ziggy: {e}")
        
        return {"status": "success", "message": "Memory deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting memory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Notes Management Routes
# ================================

@api_router.post("/notes", response_model=Note)
async def create_note(note_data: NoteCreate):
    """Create a new note"""
    try:
        note_obj = Note(**note_data.dict())
        await db.notes.insert_one(note_obj.dict())
        return note_obj
    except Exception as e:
        logger.error(f"Error creating note: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/notes", response_model=List[Note])
async def get_notes():
    """Get all notes"""
    notes = await db.notes.find().sort("created_at", -1).to_list(1000)
    return [Note(**note) for note in notes]

@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    """Delete a specific note"""
    try:
        result = await db.notes.delete_one({"id": note_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Note not found")
        
        return {"status": "success", "message": "Note deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting note: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Smart Home Control Routes
# ================================

@api_router.post("/smarthome/lights")
async def control_lights(control: SmartHomeControl):
    """Control smart lights"""
    try:
        params = {"room": control.room, **control.params}
        
        if control.action == "toggle":
            intent = "toggle_light"
        elif control.action == "set_color":
            intent = "set_light_color"
        elif control.action == "set_brightness":
            intent = "set_light_brightness"
        else:
            raise HTTPException(status_code=400, detail="Invalid light action")
        
        ziggy_intent = ZiggyIntent(
            intent=intent,
            params=params,
            source="web_app"
        )
        
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error controlling lights: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/smarthome/ac")
async def control_ac(control: SmartHomeControl):
    """Control air conditioning"""
    try:
        if control.action == "toggle":
            intent = "control_ac"
        elif control.action == "set_temperature":
            intent = "set_ac_temperature"
        else:
            raise HTTPException(status_code=400, detail="Invalid AC action")
        
        ziggy_intent = ZiggyIntent(
            intent=intent,
            params=control.params,
            source="web_app"
        )
        
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error controlling AC: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/smarthome/tv")
async def control_tv(control: SmartHomeControl):
    """Control TV"""
    try:
        if control.action == "toggle":
            intent = "control_tv"
        elif control.action == "set_source":
            intent = "set_tv_source"
        else:
            raise HTTPException(status_code=400, detail="Invalid TV action")
        
        ziggy_intent = ZiggyIntent(
            intent=intent,
            params=control.params,
            source="web_app"
        )
        
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error controlling TV: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/smarthome/sensors/{room}")
async def get_sensors(room: str, sensor_type: str = "temperature"):
    """Get sensor data for a room"""
    try:
        if sensor_type == "temperature":
            intent = "get_temperature"
        elif sensor_type == "humidity":
            intent = "get_humidity"
        else:
            raise HTTPException(status_code=400, detail="Invalid sensor type")
        
        ziggy_intent = ZiggyIntent(
            intent=intent,
            params={"room": room},
            source="web_app"
        )
        
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting sensor data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Chat Routes
# ================================

@api_router.post("/chat")
async def chat_with_ziggy(chat_request: ChatRequest):
    """Chat with Ziggy using GPT"""
    try:
        # Store user message
        user_message = ChatMessage(role="user", content=chat_request.message)
        await db.chat_history.insert_one(user_message.dict())
        
        # Send to Ziggy for processing
        ziggy_intent = ZiggyIntent(
            intent="chat_with_gpt",
            params={"text": chat_request.message},
            source="web_app"
        )
        
        result = await call_ziggy_intent(ziggy_intent)
        
        # Store assistant response
        if result.get("status") == "success" or "message" in result:
            response_text = result.get("message", result.get("response", "Sorry, I didn't understand that."))
            assistant_message = ChatMessage(role="assistant", content=response_text)
            await db.chat_history.insert_one(assistant_message.dict())
            
            return {"response": response_text}
        else:
            return {"response": "Sorry, I encountered an error processing your message."}
            
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return {"response": "Sorry, I'm having trouble right now. Please try again later."}

@api_router.get("/chat/history")
async def get_chat_history(limit: int = 50):
    """Get recent chat history"""
    try:
        messages = await db.chat_history.find().sort("timestamp", -1).limit(limit).to_list(limit)
        messages.reverse()  # Show oldest first
        return [ChatMessage(**msg) for msg in messages]
    except Exception as e:
        logger.error(f"Error getting chat history: {e}")
        return []

# ================================
# System Control Routes
# ================================

@api_router.get("/system/status")
async def get_system_status():
    """Get system status information"""
    try:
        ziggy_intent = ZiggyIntent(intent="get_system_status", source="web_app")
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except Exception as e:
        logger.error(f"Error getting system status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/system/time")
async def get_current_time():
    """Get current time"""
    try:
        ziggy_intent = ZiggyIntent(intent="get_time", source="web_app")
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except Exception as e:
        logger.error(f"Error getting time: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/system/date")
async def get_current_date():
    """Get current date"""
    try:
        ziggy_intent = ZiggyIntent(intent="get_date", source="web_app")
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except Exception as e:
        logger.error(f"Error getting date: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/system/restart")
async def restart_ziggy():
    """Restart Ziggy system"""
    try:
        ziggy_intent = ZiggyIntent(intent="restart_ziggy", source="web_app")
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except Exception as e:
        logger.error(f"Error restarting Ziggy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/system/shutdown")
async def shutdown_ziggy():
    """Shutdown Ziggy system"""
    try:
        ziggy_intent = ZiggyIntent(intent="shutdown_ziggy", source="web_app")
        result = await call_ziggy_intent(ziggy_intent)
        return result
    except Exception as e:
        logger.error(f"Error shutting down Ziggy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in the main app
app.include_router(api_router)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
