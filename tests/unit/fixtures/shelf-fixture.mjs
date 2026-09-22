// Fixture engine for the DEFAULT runner seam (tests spawn `node <this file>`).
// argv[2] === 'fail' -> exit 1 with stderr; otherwise print a valid v1 payload.
if (process.argv.includes('fail')) {
	process.stderr.write('boom from fixture engine');
	process.exit(1);
}
process.stdout.write(
	JSON.stringify({ v: 1, ok: true, reused: false, present: true, snapshot: { generatedAt: 'fixture', sources: [] }, _args: process.argv.slice(2) })
);
