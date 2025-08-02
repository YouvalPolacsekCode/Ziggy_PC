import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from core.memory import remember, list_memory

remember("test_key", "test_value")
print(list_memory())
