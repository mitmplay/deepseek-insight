/**
 * DSH file-type classification, ported from deepseek-harness
 * packages/client/ui-primitives/src/FileTypeIcon.tsx and code-file-types.ts
 * (DSH working tree c291e7961a, past dsh-v0.1.5-rc.1). The code branch
 * resolves to DSH's per-language CodeFileIcon categories; the traditional
 * branch to the shared file glyph. Divergence: the Flutter rule needs a
 * project-file snapshot DSI does not have, so .dart always answers 'dart'
 * and 'flutter' exists only in the TYPE + artwork table (the host resolves
 * it through pubspec.yaml content DSI never reads).
 */

/** The traditional presentation categories the shared DSH file glyph draws. */
export type FileType = 'code' | 'excel' | 'html' | 'image' | 'markdown' | 'other' | 'pdf' | 'ppt' | 'video' | 'word';

/** Code and configuration categories with their own full-color square glyph. */
export const CODE_FILE_TYPES = [
	'angular', 'c', 'clojure', 'cmake', 'cpp', 'csharp', 'css', 'dart', 'docker',
	'elixir', 'env', 'erlang', 'flutter', 'git', 'go', 'graphql', 'haskell', 'ini', 'java',
	'javascript', 'json', 'kotlin', 'lua', 'makefile', 'node', 'objective-c', 'perl',
	'php', 'powershell', 'protobuf', 'python', 'r', 'react', 'ruby', 'rust', 'scala',
	'shell', 'solidity', 'sql', 'svelte', 'swift', 'toml', 'typescript', 'vue', 'wasm',
	'xml', 'yaml', 'zig'
] as const;

export type CodeFileType = (typeof CODE_FILE_TYPES)[number];

/** Every classification the explorer renders. */
export type ResolvedFileType = FileType | CodeFileType;

const CODE_FILE_TYPE_SET: ReadonlySet<string> = new Set(CODE_FILE_TYPES);

/** Known non-code names DSH presents as markdown. */
const NAME_TYPES: Readonly<Record<string, FileType>> = {
	changelog: 'markdown',
	contributing: 'markdown',
	readme: 'markdown'
};

/** Extension to category, ported verbatim from the DSH EXTENSION_TYPES table. */
const EXTENSION_TYPES: Readonly<Record<string, FileType>> = {
	scss: 'code', sass: 'code', less: 'code', astro: 'code',
	bat: 'code', cmd: 'code', csv: 'code', tsv: 'code',
	html: 'html', htm: 'html',
	png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
	avif: 'image', bmp: 'image', ico: 'image', tif: 'image', tiff: 'image', heic: 'image', heif: 'image',
	md: 'markdown', mdx: 'markdown', markdown: 'markdown',
	pdf: 'pdf',
	ppt: 'ppt', pptx: 'ppt', key: 'ppt',
	mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video', mpg: 'video', mpeg: 'video',
	doc: 'word', docx: 'word', rtf: 'word', odt: 'word', pages: 'word',
	xls: 'excel', xlsx: 'excel', xlsm: 'excel', numbers: 'excel'
};

/** Exact file names that resolve to a code category (DSH FILE_NAME_TYPES). */
const CODE_NAME_TYPES: Readonly<Record<string, CodeFileType>> = {
	'.bash_profile': 'shell', '.bashrc': 'shell', '.env': 'env',
	'.gitattributes': 'git', '.gitconfig': 'git', '.gitignore': 'git',
	'.gitmodules': 'git', '.mailmap': 'git', '.profile': 'shell',
	'.zprofile': 'shell', '.zshrc': 'shell',
	bsdmakefile: 'makefile', 'cmakelists.txt': 'cmake', commit_editmsg: 'git',
	'compose.yaml': 'docker', 'compose.yml': 'docker',
	'docker-compose.yaml': 'docker', 'docker-compose.yml': 'docker',
	dockerfile: 'docker', gemfile: 'ruby', gnumakefile: 'makefile',
	guardfile: 'ruby', makefile: 'makefile', 'npm-shrinkwrap.json': 'node',
	'package-lock.json': 'node', 'package.json': 'node', podfile: 'ruby',
	rakefile: 'ruby'
};

/** Basename prefixes that resolve to a code category (DSH FILE_NAME_PREFIX_TYPES). */
const CODE_NAME_PREFIX_TYPES: readonly (readonly [string, CodeFileType])[] = [
	['dockerfile.', 'docker'],
	['.env.', 'env']
];

/** Basename suffixes that resolve to a code category (DSH FILE_NAME_SUFFIX_TYPES). */
const CODE_NAME_SUFFIX_TYPES: readonly (readonly [string, CodeFileType])[] = [
	['.component.ts', 'angular'], ['.component.html', 'angular'],
	['.directive.ts', 'angular'], ['.service.ts', 'angular'],
	['.module.ts', 'angular'], ['.pipe.ts', 'angular'], ['.guard.ts', 'angular'],
	['.interceptor.ts', 'angular'], ['.dockerfile', 'docker']
];

/** Extension to code category, ported verbatim from DSH EXTENSION_TYPES. */
const CODE_EXTENSION_TYPES: Readonly<Record<string, CodeFileType>> = {
	bash: 'shell', c: 'c', 'c++': 'cpp', cc: 'cpp', cfg: 'ini', cjs: 'javascript',
	clj: 'clojure', cljc: 'clojure', cljs: 'clojure', cmake: 'cmake', cpp: 'cpp',
	cs: 'csharp', csh: 'shell', css: 'css', csx: 'csharp', cts: 'typescript',
	cxx: 'cpp', dart: 'dart', dtd: 'xml', edn: 'clojure', env: 'env', erl: 'erlang',
	es6: 'javascript', escript: 'erlang', ex: 'elixir', exs: 'elixir', fish: 'shell',
	gemspec: 'ruby', go: 'go', gql: 'graphql', graphql: 'graphql', h: 'c',
	'h++': 'cpp', hh: 'cpp', hpp: 'cpp', hrl: 'erlang', hs: 'haskell', hxx: 'cpp',
	ini: 'ini', ipp: 'cpp', java: 'java', js: 'javascript', json: 'json',
	json5: 'json', jsonc: 'json', jsx: 'react', ksh: 'shell', kt: 'kotlin',
	kts: 'kotlin', lhs: 'haskell', lua: 'lua', m: 'objective-c', mak: 'makefile',
	mjs: 'javascript', mk: 'makefile', mm: 'objective-c', node: 'node', pch: 'objective-c',
	php: 'php', php3: 'php', php4: 'php', php5: 'php', phps: 'php', phtml: 'php',
	pl: 'perl', plist: 'xml', pm: 'perl', pod: 'perl', proto: 'protobuf', ps1: 'powershell',
	psd1: 'powershell', psm1: 'powershell', py: 'python', pyi: 'python', pyw: 'python',
	pyx: 'python', r: 'r', rake: 'ruby', rb: 'ruby', rmd: 'r', rs: 'rust', sc: 'scala',
	scala: 'scala', sh: 'shell', sol: 'solidity', sql: 'sql',
	svelte: 'svelte', swift: 'swift', t: 'perl', tcsh: 'shell', toml: 'toml',
	tpp: 'cpp', ts: 'typescript', tsx: 'react', vue: 'vue', wasm: 'wasm',
	wast: 'wasm', wat: 'wasm', xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml',
	yaml: 'yaml', yml: 'yaml', zig: 'zig', zsh: 'shell'
};

/** Final suffix of a basename, lowercased; empty string when there is none. */
function fileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Resolve the most specific code/configuration category (DSH classifyCodeFileType,
 * without the project-context Flutter rule).
 * @param name - Lowercased file basename.
 * @param extension - Lowercased extension without the leading dot.
 * @returns The code category, or null when the traditional classifier owns the name.
 */
function classifyCodeFileType(name: string, extension: string): CodeFileType | null {
	const exact = CODE_NAME_TYPES[name];
	if (exact !== undefined) return exact;
	for (const [prefix, type] of CODE_NAME_PREFIX_TYPES) {
		if (name.startsWith(prefix)) return type;
	}
	for (const [suffix, type] of CODE_NAME_SUFFIX_TYPES) {
		if (name.endsWith(suffix)) return type;
	}
	return CODE_EXTENSION_TYPES[extension] ?? null;
}

/**
 * Classify a file name for explorer presentation, code rules before the
 * traditional table, exactly like DSH's classifyFileType ordering.
 * @param name - File basename (the explorer listing entries are basenames).
 * @returns The closed presentation category.
 */
export function classifyFileType(name: string): ResolvedFileType {
	const lower = name.toLowerCase();
	const ext = fileExtension(lower);
	return classifyCodeFileType(lower, ext)
		?? NAME_TYPES[lower]
		?? EXTENSION_TYPES[ext]
		?? 'other';
}

/** Test whether a resolved value draws the full-color code square. */
export function isCodeFileType(type: ResolvedFileType): type is CodeFileType {
	return CODE_FILE_TYPE_SET.has(type);
}
