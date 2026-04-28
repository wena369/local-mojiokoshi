# fix_backend.py - Run this on the eGPU PC: python fix_backend.py
import re

f = open('C:/ai-transcriber-backend/main.py', 'r', encoding='utf-8')
c = f.read()
f.close()

# 1. Add speaker_readings to request models
old_model = '''    segments: list
    speaker_names: dict = {}'''
new_model = '''    segments: list
    speaker_names: dict = {}
    speaker_readings: dict = {}'''
c = c.replace(old_model, new_model)
print('Step 1: Added speaker_readings to models')

# 2. Update build_name_info to accept readings
old_helper = '''def build_name_info(speaker_names):
    import re as _re
    parts = []
    for sid, fullname in speaker_names.items():
        parts.append(fullname.strip())
    return " / ".join(parts)'''
new_helper = '''def build_name_info(speaker_names, speaker_readings=None):
    parts = []
    for sid, fullname in speaker_names.items():
        name = fullname.strip()
        reading = (speaker_readings or {}).get(sid, "")
        if reading:
            parts.append(f"{name}\uff08{reading}\uff09")
        else:
            parts.append(name)
    return " / ".join(parts)'''
c = c.replace(old_helper, new_helper)
print('Step 2: Updated build_name_info helper')

# 3. Update refine call to pass readings
c = c.replace(
    'name_info = build_name_info(req.speaker_names)',
    'name_info = build_name_info(req.speaker_names, req.speaker_readings)'
)
print('Step 3: Updated build_name_info calls')

# 4. Update summarize prompt to include participant names
old_sum_final = '"5.\u7c21\u6f54\u6b63\u78ba\u306b\\n\\n"'
new_sum_final = '"5.\u7c21\u6f54\u6b63\u78ba\u306b\\n"\n                "6.\u53c2\u52a0\u8005\u540d\u3092\u660e\u8a18\u3057\u3001\u8ab0\u304c\u4f55\u3092\u8a00\u3063\u305f\u304b\u3092\u660e\u78ba\u306b\\n\\n"'
c = c.replace(old_sum_final, new_sum_final)
print('Step 4: Updated summary prompt to include names')

f = open('C:/ai-transcriber-backend/main.py', 'w', encoding='utf-8')
f.write(c)
f.close()
print('All done!')
