"""Signage device agent.

Runs on each in-store player (Raspberry Pi OS or Ubuntu thin client): enrols
with the server, downloads its assigned playlist to a local cache with checksum
verification, plays it on a loop with mpv, and heartbeats its status. Keeps
playing the last cached playlist when the network drops.
"""

__version__ = "0.2.0"
