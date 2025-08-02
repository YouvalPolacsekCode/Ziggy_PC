import sys
import os

# 👇 Add Ziggy_PC_FULL root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from flask import Flask, request, jsonify
from flask_cors import CORS
from core.intent_parser import quick_parse
from core.action_parser import handle_intent
import asyncio

app = Flask(__name__)
CORS(app)

@app.route('/api/intent', methods=['POST'])
def handle_web_intent():
    try:
        data = request.json

        # If it's a raw text message, parse it to get the intent
        if 'text' in data.get('params', {}):
            intent_result = quick_parse(data['params']['text'])
        else:
            # Direct intent call with intent + params
            intent_result = {
                'intent': data.get('intent'),
                'params': data.get('params', {}),
                'source': data.get('source', 'web_app')
            }

        # Handle async or sync intent execution
        if asyncio.iscoroutinefunction(handle_intent):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(handle_intent(intent_result))
            loop.close()
        else:
            result = handle_intent(intent_result)

        return jsonify({'status': 'success', 'message': result})

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050, debug=True)
