import io
p = "/Users/wharsojo/agentic-ai/deepseek-insight/.agents/skills/dsi-plugin-rack/SKILL.md"
lines = io.open(p, encoding="utf-8").read().split("
")
lines[22] = "- **The manifest's dependencies are the install authority (D4, amended 2026-09-27).** pnpm records git plugins under the package's OWN scoped name (`@owner/name`), not the reff id - matching is by repo identity (exact id, or the owner/name tail in the dep resolution), and the recorded key is captured as `pkg` and IS the remove target. Bundle entries are a derived hint, never the gate; after dsh reports success the engine re-reads the manifest and DISTRUSTS success it cannot see recorded."
io.open(p, "w", encoding="utf-8").write("
".join(lines))
print("replaced")
