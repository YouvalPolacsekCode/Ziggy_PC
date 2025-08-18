import requests
import sys
import json

class ZiggySystemTester:
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

    def test_system_endpoints(self):
        """Test system control endpoints (without actually restarting/shutting down)"""
        print("\n⚙️ Testing System Control Endpoints...")
        
        # Test system status (should work)
        success, status_data = self.run_test("System Status", "GET", "system/status", 200)
        
        # Test current time (should work)
        success, time_data = self.run_test("Current Time", "GET", "system/time", 200)
        
        # Test current date (should work)
        success, date_data = self.run_test("Current Date", "GET", "system/date", 200)
        
        # Test restart endpoint (should respond but not actually restart)
        # Note: This will likely return an error since Ziggy instance isn't running
        success, restart_data = self.run_test("System Restart", "POST", "system/restart", 200)
        
        # Test shutdown endpoint (should respond but not actually shutdown)
        # Note: This will likely return an error since Ziggy instance isn't running
        success, shutdown_data = self.run_test("System Shutdown", "POST", "system/shutdown", 200)
        
        return True

    def test_additional_intents(self):
        """Test additional intent types"""
        print("\n🎯 Testing Additional Intent Types...")
        
        # Test get_system_status intent
        intent_data = {
            "intent": "get_system_status",
            "params": {},
            "source": "web_app"
        }
        success, _ = self.run_test("System Status Intent", "POST", "intent", 200, intent_data)
        
        # Test get_ip_address intent
        intent_data = {
            "intent": "get_ip_address",
            "params": {},
            "source": "web_app"
        }
        success, _ = self.run_test("IP Address Intent", "POST", "intent", 200, intent_data)
        
        # Test ping_test intent
        intent_data = {
            "intent": "ping_test",
            "params": {"domain": "google.com"},
            "source": "web_app"
        }
        success, _ = self.run_test("Ping Test Intent", "POST", "intent", 200, intent_data)
        
        # Test unknown intent
        intent_data = {
            "intent": "unknown_intent",
            "params": {},
            "source": "web_app"
        }
        success, _ = self.run_test("Unknown Intent", "POST", "intent", 200, intent_data)
        
        return True

    def test_cors_functionality(self):
        """Test CORS functionality"""
        print("\n🌐 Testing CORS Functionality...")
        
        # Test OPTIONS request (preflight)
        try:
            response = requests.options(f"{self.base_url}/tasks", 
                                      headers={'Origin': 'http://localhost:3000'}, 
                                      timeout=10)
            self.tests_run += 1
            if response.status_code in [200, 204]:
                self.tests_passed += 1
                print(f"✅ CORS Preflight - Status: {response.status_code}")
                print(f"   CORS Headers: {dict(response.headers)}")
            else:
                print(f"❌ CORS Preflight Failed - Status: {response.status_code}")
        except Exception as e:
            print(f"❌ CORS Test Failed - Error: {str(e)}")
            self.tests_run += 1
        
        return True

def main():
    print("🚀 Starting Ziggy Web Interface System & Additional API Tests...")
    print("=" * 70)
    
    # Setup
    tester = ZiggySystemTester("http://localhost:8001/api")
    
    # Run all tests
    try:
        tester.test_system_endpoints()
        tester.test_additional_intents()
        tester.test_cors_functionality()
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Unexpected error during testing: {e}")
    
    # Print final results
    print("\n" + "=" * 70)
    print(f"📊 SYSTEM & ADDITIONAL TEST RESULTS:")
    print(f"   Tests Run: {tester.tests_run}")
    print(f"   Tests Passed: {tester.tests_passed}")
    print(f"   Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"   Success Rate: {(tester.tests_passed/tester.tests_run*100):.1f}%" if tester.tests_run > 0 else "   Success Rate: 0%")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All system tests passed!")
        return 0
    else:
        print("⚠️ Some system tests failed. Check the output above for details.")
        return 1

if __name__ == "__main__":
    sys.exit(main())