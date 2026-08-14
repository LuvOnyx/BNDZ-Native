# -*- coding: utf-8 -*-
"""Smoke checklist for studio parity — static presence checks."""
from pathlib import Path
import sys

ps = Path("public/editors/bndz-photo-studio.html").read_text(encoding="utf-8")
db = Path("public/editors/bndz-design-board.html").read_text(encoding="utf-8")

checks = {
    "PS dark theme CSS": "theme-dark" in ps,
    "PS theme toggle": "themeToggle" in ps and "applyPsTheme" in ps,
    "PS brush tips": "BRUSH_TIPS" in ps and "stampBrushTip" in ps,
    "PS tip options": 'data-opt="BrushTip"' in ps,
    "PS line snap": "snapLinePoint" in ps and "function commitLine" in ps,
    "PS line weight": "lineWeight" in ps,
    "PS heal": "healStamp" in ps and "spotHealAt" in ps,
    "PS gradient kinds": "buildGradient" in ps,
    "PS host setTheme": "setTheme" in ps,
    "DB booleans": "function booleanOp" in db,
    "DB auto layout": "reflowAutoLayout" in db,
    "DB dash": "dashArrayFor" in db,
    "DB distribute": "distributeSel" in db,
    "DB components": "createComponentFromSelection" in db,
    "DB Uiverse craft": "Design Board Uiverse craft polish" in db,
    "PS magnetic lasso": "magneticLassoSample" in ps,
    "PS mixer stamp": "mixerStamp" in ps,
    "PS pen bezier": "penAddPoint" in ps,
    "DB AL wrap": "alWrap" in db,
    "DB variables": "designVariables" in db,
    "DB proto": "addProtoLink" in db,
}

failed = []
for k, v in checks.items():
    print(("PASS" if v else "FAIL"), k)
    if not v:
        failed.append(k)
print("RESULT", "OK" if not failed else "FAILED: " + ", ".join(failed))
sys.exit(0 if not failed else 1)
