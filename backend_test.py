import requests
import sys
import json
from datetime import datetime
import uuid

class ZiggyAPITester:
    def __init__(self, base_url="http://localhost:8001/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_data = {}

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)[:200]}...")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except requests.exceptions.ConnectionError:
            print(f"❌ Failed - Connection Error: Could not connect to {url}")
            return False, {}
        except requests.exceptions.Timeout:
            print(f"❌ Failed - Timeout: Request timed out")
            return False, {}
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_root_endpoint(self):
        """Test the root API endpoint"""
        return self.run_test("Root API", "GET", "", 200)

    def test_intent_endpoint(self):
        """Test intent processing"""
        intent_data = {
            "intent": "get_time",
            "params": {},
            "source": "web_app"
        }
        return self.run_test("Intent Processing", "POST", "intent", 200, intent_data)

    def test_task_management(self):
        """Test task management endpoints"""
        print("\n📋 Testing Task Management...")
        
        # Test getting tasks (should be empty initially)
        success, tasks = self.run_test("Get Tasks", "GET", "tasks", 200)
        if not success:
            return False
        
        # Test creating a task
        task_data = {
            "task": "Test task from API test",
            "priority": "high",
            "notes": "This is a test task"
        }
        success, created_task = self.run_test("Create Task", "POST", "tasks", 200, task_data)
        if not success:
            return False
        
        task_id = created_task.get('id')
        if task_id:
            self.test_data['task_id'] = task_id
            
            # Test completing the task
            success, _ = self.run_test("Complete Task", "PUT", f"tasks/{task_id}/complete", 200)
            
            # Test deleting the task
            success, _ = self.run_test("Delete Task", "DELETE", f"tasks/{task_id}", 200)
        
        # Test deleting all tasks
        success, _ = self.run_test("Delete All Tasks", "DELETE", "tasks", 200)
        
        return True

    def test_memory_management(self):
        """Test memory management endpoints"""
        print("\n🧠 Testing Memory Management...")
        
        # Test getting memories
        success, memories = self.run_test("Get Memories", "GET", "memory", 200)
        if not success:
            return False
        
        # Test creating a memory
        memory_data = {
            "key": "test_memory",
            "value": "This is a test memory value"
        }
        success, created_memory = self.run_test("Create Memory", "POST", "memory", 200, memory_data)
        if not success:
            return False
        
        memory_key = created_memory.get('key')
        if memory_key:
            # Test getting specific memory
            success, _ = self.run_test("Get Specific Memory", "GET", f"memory/{memory_key}", 200)
            
            # Test deleting the memory
            success, _ = self.run_test("Delete Memory", "DELETE", f"memory/{memory_key}", 200)
        
        return True

    def test_notes_management(self):
        """Test notes management endpoints"""
        print("\n📝 Testing Notes Management...")
        
        # Test getting notes
        success, notes = self.run_test("Get Notes", "GET", "notes", 200)
        if not success:
            return False
        
        # Test creating a note
        note_data = {
            "title": "Test Note",
            "content": "This is a test note content"
        }
        success, created_note = self.run_test("Create Note", "POST", "notes", 200, note_data)
        if not success:
            return False
        
        note_id = created_note.get('id')
        if note_id:
            # Test deleting the note
            success, _ = self.run_test("Delete Note", "DELETE", f"notes/{note_id}", 200)
        
        return True

    def test_smart_home_control(self):
        """Test smart home control endpoints"""
        print("\n🏠 Testing Smart Home Control...")
        
        # Test light control
        light_data = {
            "room": "living_room",
            "action": "toggle",
            "params": {}
        }
        success, _ = self.run_test("Control Lights", "POST", "smarthome/lights", 200, light_data)
        
        # Test AC control
        ac_data = {
            "action": "toggle",
            "params": {}
        }
        success, _ = self.run_test("Control AC", "POST", "smarthome/ac", 200, ac_data)
        
        # Test TV control
        tv_data = {
            "action": "toggle",
            "params": {}
        }
        success, _ = self.run_test("Control TV", "POST", "smarthome/tv", 200, tv_data)
        
        # Test sensor data
        success, _ = self.run_test("Get Sensor Data", "GET", "smarthome/sensors/living_room?sensor_type=temperature", 200)
        
        return True

    def test_chat_functionality(self):
        """Test chat functionality"""
        print("\n💬 Testing Chat Functionality...")
        
        # Test chat
        chat_data = {
            "message": "Hello, this is a test message"
        }
        success, _ = self.run_test("Chat with Ziggy", "POST", "chat", 200, chat_data)
        
        # Test getting chat history
        success, _ = self.run_test("Get Chat History", "GET", "chat/history", 200)
        
        return True

    def test_system_control(self):
        """Test system control endpoints"""
        print("\n⚙️ Testing System Control...")
        
        # Test system status
        success, _ = self.run_test("Get System Status", "GET", "system/status", 200)
        
        # Test get time
        success, _ = self.run_test("Get Current Time", "GET", "system/time", 200)
        
        # Test get date
        success, _ = self.run_test("Get Current Date", "GET", "system/date", 200)
        
        # Note: Not testing restart/shutdown as they would affect the system
        
        return True

def main():
    print("🚀 Starting Ziggy Web Interface API Tests...")
    print("=" * 60)
    
    # Setup
    tester = ZiggyAPITester("http://localhost:8001")
    
    # Run all tests
    try:
        # Basic connectivity
        print("\n🔌 Testing Basic Connectivity...")
        tester.test_root_endpoint()
        
        # Intent processing
        print("\n🎯 Testing Intent Processing...")
        tester.test_intent_endpoint()
        
        # Core functionality tests
        tester.test_task_management()
        tester.test_memory_management()
        tester.test_notes_management()
        tester.test_smart_home_control()
        tester.test_chat_functionality()
        tester.test_system_control()
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Unexpected error during testing: {e}")
    
    # Print final results
    print("\n" + "=" * 60)
    print(f"📊 FINAL RESULTS:")
    print(f"   Tests Run: {tester.tests_run}")
    print(f"   Tests Passed: {tester.tests_passed}")
    print(f"   Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"   Success Rate: {(tester.tests_passed/tester.tests_run*100):.1f}%" if tester.tests_run > 0 else "   Success Rate: 0%")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️ Some tests failed. Check the output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())