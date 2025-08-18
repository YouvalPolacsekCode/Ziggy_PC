import requests
import sys
import json
from datetime import datetime
import uuid

class ZiggyAPIErrorTester:
    def __init__(self, base_url="http://localhost:8001/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
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

    def test_task_error_handling(self):
        """Test task management error handling"""
        print("\n📋 Testing Task Error Handling...")
        
        # Test completing non-existent task
        fake_task_id = str(uuid.uuid4())
        success, _ = self.run_test("Complete Non-existent Task", "PUT", f"tasks/{fake_task_id}/complete", 404)
        
        # Test deleting non-existent task
        success, _ = self.run_test("Delete Non-existent Task", "DELETE", f"tasks/{fake_task_id}", 404)
        
        # Test creating task with missing required field
        invalid_task_data = {
            "priority": "high",
            "notes": "Missing task field"
        }
        success, _ = self.run_test("Create Task Missing Required Field", "POST", "tasks", 422, invalid_task_data)
        
        return True

    def test_memory_error_handling(self):
        """Test memory management error handling"""
        print("\n🧠 Testing Memory Error Handling...")
        
        # Test getting non-existent memory
        fake_key = "non_existent_key_" + str(uuid.uuid4())[:8]
        success, _ = self.run_test("Get Non-existent Memory", "GET", f"memory/{fake_key}", 404)
        
        # Test deleting non-existent memory
        success, _ = self.run_test("Delete Non-existent Memory", "DELETE", f"memory/{fake_key}", 404)
        
        # Test creating memory with missing required field
        invalid_memory_data = {
            "value": "Missing key field"
        }
        success, _ = self.run_test("Create Memory Missing Required Field", "POST", "memory", 422, invalid_memory_data)
        
        return True

    def test_notes_error_handling(self):
        """Test notes management error handling"""
        print("\n📝 Testing Notes Error Handling...")
        
        # Test deleting non-existent note
        fake_note_id = str(uuid.uuid4())
        success, _ = self.run_test("Delete Non-existent Note", "DELETE", f"notes/{fake_note_id}", 404)
        
        # Test creating note with missing required field
        invalid_note_data = {
            "content": "Missing title field"
        }
        success, _ = self.run_test("Create Note Missing Required Field", "POST", "notes", 422, invalid_note_data)
        
        return True

    def test_smart_home_error_handling(self):
        """Test smart home control error handling"""
        print("\n🏠 Testing Smart Home Error Handling...")
        
        # Test invalid light action
        invalid_light_data = {
            "room": "living_room",
            "action": "invalid_action",
            "params": {}
        }
        success, _ = self.run_test("Invalid Light Action", "POST", "smarthome/lights", 400, invalid_light_data)
        
        # Test invalid AC action
        invalid_ac_data = {
            "action": "invalid_action",
            "params": {}
        }
        success, _ = self.run_test("Invalid AC Action", "POST", "smarthome/ac", 400, invalid_ac_data)
        
        # Test invalid TV action
        invalid_tv_data = {
            "action": "invalid_action",
            "params": {}
        }
        success, _ = self.run_test("Invalid TV Action", "POST", "smarthome/tv", 400, invalid_tv_data)
        
        # Test invalid sensor type
        success, _ = self.run_test("Invalid Sensor Type", "GET", "smarthome/sensors/living_room?sensor_type=invalid", 400)
        
        return True

    def test_intent_error_handling(self):
        """Test intent processing error handling"""
        print("\n🎯 Testing Intent Error Handling...")
        
        # Test invalid intent data (missing required fields)
        invalid_intent_data = {
            "params": {},
            "source": "web_app"
        }
        success, _ = self.run_test("Intent Missing Required Field", "POST", "intent", 422, invalid_intent_data)
        
        return True

    def test_chat_error_handling(self):
        """Test chat functionality error handling"""
        print("\n💬 Testing Chat Error Handling...")
        
        # Test chat with missing message
        invalid_chat_data = {}
        success, _ = self.run_test("Chat Missing Message", "POST", "chat", 422, invalid_chat_data)
        
        return True

def main():
    print("🚀 Starting Ziggy Web Interface API Error Handling Tests...")
    print("=" * 70)
    
    # Setup
    tester = ZiggyAPIErrorTester("http://localhost:8001/api")
    
    # Run all error tests
    try:
        tester.test_task_error_handling()
        tester.test_memory_error_handling()
        tester.test_notes_error_handling()
        tester.test_smart_home_error_handling()
        tester.test_intent_error_handling()
        tester.test_chat_error_handling()
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Unexpected error during testing: {e}")
    
    # Print final results
    print("\n" + "=" * 70)
    print(f"📊 ERROR HANDLING TEST RESULTS:")
    print(f"   Tests Run: {tester.tests_run}")
    print(f"   Tests Passed: {tester.tests_passed}")
    print(f"   Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"   Success Rate: {(tester.tests_passed/tester.tests_run*100):.1f}%" if tester.tests_run > 0 else "   Success Rate: 0%")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All error handling tests passed!")
        return 0
    else:
        print("⚠️ Some error handling tests failed. Check the output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())