"""The cutter, for the game: built in art/lib/craft.py.

    npm run art:build -- game-cutter
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import craft  # noqa: E402

craft.build("cutter")
