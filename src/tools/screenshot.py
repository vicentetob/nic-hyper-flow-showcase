import sys
import json
import os
import time

try:
    import pyautogui
except ImportError:
    print(json.dumps({
        "ok": False, 
        "error": "Biblioteca 'pyautogui' não encontrada.",
        "suggestion": "Instale a dependência necessária executando: pip install pyautogui",
        "missing_dependency": "pyautogui"
    }))
    sys.exit(1)

def take_screenshot(save_path=None):
    if save_path is None:
        timestamp = int(time.time())
        save_path = os.path.join(os.environ.get('TEMP', '/tmp'), f"vscode_screenshot_{timestamp}.png")
    
    try:
        # Tira o screenshot de toda a tela
        screenshot = pyautogui.screenshot()
        screenshot.save(save_path)
        print(f"SUCCESS:{save_path}")
    except Exception as e:
        print(f"ERROR:{str(e)}")

if __name__ == "__main__":
    path_arg = sys.argv[1] if len(sys.argv) > 1 else None
    take_screenshot(path_arg)
