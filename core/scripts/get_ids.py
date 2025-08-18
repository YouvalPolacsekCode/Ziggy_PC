import json

def find_entity_ids(data):
    entity_ids = []
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "entity_id":
                entity_ids.append(value)
            else:
                entity_ids.extend(find_entity_ids(value))
    elif isinstance(data, list):
        for item in data:
            entity_ids.extend(find_entity_ids(item))
    return entity_ids

# Change 'file.json' to your JSON file path
with open("core\scripts\HA_ids.json", "r", encoding="utf-8") as f:
    json_data = json.load(f)

entity_ids = find_entity_ids(json_data)
for eid in entity_ids:
    print(eid)
