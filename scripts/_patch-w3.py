import io
p = 'scripts/migrate-w3.mjs'
src = io.open(p, encoding='utf-8').read()
lines = src.split('
')
start = 228  # 0-based line 229
end = 232    # 0-based line 232 inclusive -> slice end 232
block = [
 "	if (!src.includes(\"$lib/paraglide/messages'\")) {",
 "		const lines2 = src.split('\\n');",
 "		const open = lines2.findIndex((l) => /^<script[^>]*>$/.test(l.trim()));",
 "		if (open >= 0) {",
 "			lines2.splice(open + 1, 0, \"\\timport * as m from '$lib/paraglide/messages';\");",
 "			src = lines2.join('\\n');",
 "		}",
 "	}"
]
out = lines[:start] + block + lines[end+1:]
io.open(p, 'w', encoding='utf-8').write('
'.join(out))
print('patched, new length:', len(out))
