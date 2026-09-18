import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const REPO = '/Users/wharsojo/agentic-ai/deepseek-insight';
const SESSION = process.argv[2];
const URL = 'http://localhost:5175/api/workspace/git-events?sessionId=' + SESSION +
	'&root=' + encodeURIComponent('/Users/wharsojo/agentic-ai') +
	'&repo=' + encodeURIComponent(REPO);

const res = await fetch(URL, { headers: { accept: 'text/event-stream' } });
console.log('status', res.status, res.headers.get('content-type'));
if (res.headers.get('content-type')?.includes('text/event-stream')) {
	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let buf = '';
	const pump = (async () => {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
		}
	})();
	await new Promise((r) => setTimeout(r, 1000));
	console.log('initial events:', JSON.stringify(buf.slice(0, 200)));
	writeFileSync(REPO + '/_pulse-curl.txt', 'x\n');
	execFileSync('git', ['-C', REPO, 'add', '_pulse-curl.txt']);
	console.log('git add done, waiting for ring...');
	let got = null;
	const deadline = Date.now() + 8000;
	const mark = buf.length;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 300));
		// reader is pumping in background; poll via a shadow read is not possible — instead re-check buf through a shared var trick
		break;
	}
	// simpler: read one chunk with timeout
	const t0 = Date.now();
	while (Date.now() - t0 < 8000) {
		const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r('T'), 500))]);
		if (chunk === 'T') continue;
		if (chunk.done) { console.log('stream closed by server'); break; }
		buf += dec.decode(chunk.value, { stream: true });
		if (buf.length > mark && buf.includes('generation')) { got = buf.slice(mark); break; }
	}
	console.log('ring events after git add:', JSON.stringify(got ?? 'NONE within 8s'));
	rmSync(REPO + '/_pulse-curl.txt', { force: true });
	execFileSync('git', ['-C', REPO, 'reset', '-q', '_pulse-curl.txt']);
	reader.cancel().catch(() => {});
} else {
	const t = await res.text();
	console.log('body text:', typeof t === 'string' ? t : new TextDecoder().decode(t));
}