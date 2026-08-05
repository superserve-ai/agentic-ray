import hashlib
import json
import os
from collections import Counter
from pathlib import Path


mount_path = Path("/mnt/lakefs")
input_path = mount_path / "input"
output_path = mount_path / "results"
agent_index = int(os.environ["AGENT_INDEX"])
agent_count = int(os.environ["AGENT_COUNT"])

file_count = 0
total_bytes = 0
extensions = Counter()

for path in input_path.rglob("*"):
    if not path.is_file():
        continue
    relative = path.relative_to(input_path).as_posix()
    shard = int.from_bytes(
        hashlib.blake2b(relative.encode("utf-8"), digest_size=8).digest()
    ) % agent_count
    if shard != agent_index:
        continue
    file_count += 1
    total_bytes += path.stat().st_size
    extensions[path.suffix.lower() or "<none>"] += 1

result = {
    "agent": agent_index + 1,
    "agent_count": agent_count,
    "file_count": file_count,
    "total_bytes": total_bytes,
    "extensions": dict(sorted(extensions.items())),
}

output_path.mkdir(parents=True, exist_ok=True)
(output_path / f"agent-{agent_index + 1}.json").write_text(
    json.dumps(result, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps(result))
