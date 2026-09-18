// Fix W3 catalog values: re-write every migrated key with explicit
// [en, zh, id] triples (the first pass wrote 2-tuples into the wrong slots).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const C = {
	attachImages: ['Attach images', '附加图片', 'Lampirkan gambar'],
	commandHelp: ['Command help', '命令帮助', 'Bantuan perintah'],
	closePreview: ['Close preview', '关闭预览', 'Tutup pratinjau'],
	originalImagePreview: ['Original image preview', '原始图片预览', 'Pratinjau gambar asli'],
	del: ['Del', 'Del', 'Del'],
	autoCheckTitle: ['Auto-check rows with this many uses (0 = off)', '自动勾选达到此使用次数的行(0 = 关)', 'Centang otomatis baris dengan pakai sebanyak ini (0 = mati)'],
	selectedRows: ['☑ Selected', '☑ 已选', '☑ Dipilih'],
	showOnlySelected: ['Show only selected rows', '仅显示已选行', 'Hanya tampilkan baris terpilih'],
	searchPrompts: ['Search prompts…', '搜索提示…', 'Cari prompt…'],
	close: ['Close', '关闭', 'Tutup'],
	promptsManager: ['Prompts manager', '提示管理器', 'Pengelola prompt'],
	manageSavedPrompts: ['Manage saved prompts', '管理已保存的提示', 'Kelola prompt tersimpan'],
	slashMenu: ['Slash menu', '斜杠菜单', 'Menu slash'],
	stickToBottom: ['Stick to bottom', '固定到底部', 'Tempel ke bawah'],
	streaming: ['streaming', '正在输出', 'sedang menyiarkan'],
	tokenCounterTitle: ['Heuristic estimate (~4 chars/token) of the draft', '草稿的启发式估算(约 4 字符/令牌)', 'Perkiraan heuristik (~4 karakter/token) dari draf'],
	escHidesA: ['Esc hides this · delete the', '按 Esc 隐藏此卡 · 删除', 'Esc menyembunyikan ini · hapus'],
	escHidesB: ['to keep composing', '以继续输入', 'untuk terus menulis'],
	filterByDate: ['Filter by date', '按日期筛选', 'Filter menurut tanggal'],
	filterSessionsByDate: ['Filter sessions by date', '按日期筛选会话', 'Filter sesi menurut tanggal'],
	forkFromTurn: ['Fork from this turn', '从此轮分叉', 'Cabang dari giliran ini'],
	forkFromTurnLong: ['Fork from this turn — branch a new session ending at this turn', '从此轮分叉 — 建立以该轮结束的新会话', 'Cabang dari giliran ini — buat sesi baru berakhir di giliran ini'],
	addWorkspace: ['Add workspace', '添加工作区', 'Tambah workspace'],
	previousMonth: ['Previous month', '上个月', 'Bulan sebelumnya'],
	nextMonth: ['Next month', '下个月', 'Bulan berikutnya'],
	datePicker: ['Date picker', '日期选择器', 'Pemilih tanggal'],
	currentPlan: ['Current Plan (', '当前计划 (', 'Rencana saat ini ('],
	donePart: [' done)', ' 完成)', ' selesai)'],
	userMessages: ['User Messages (', '用户消息 (', 'Pesan pengguna ('],
	copyReasoning: ['Copy reasoning', '复制推理', 'Salin penalaran'],
	copyOutput: ['Copy output', '复制输出', 'Salin keluaran'],
	toolApproval: ['Tool approval:', '工具审批:', 'Persetujuan alat:'],
	copyFullPath: ['Copy full path', '复制完整路径', 'Salin path lengkap'],
	runtimeContext: ['⚙ runtime context ·', '⚙ 运行时上下文 ·', '⚙ konteks runtime ·'],
	systemPrompt: ['System prompt', '系统提示', 'Prompt sistem'],
	peekToolCalls: ['Peek all tool calls as list', '以列表查看所有工具调用', 'Lihat semua panggilan alat sebagai daftar'],
	turnFailed: ['turn failed', '轮次失败', 'giliran gagal'],
	usage: ['Usage', '用量', 'Pemakaian'],
	noConversations: ['No conversations open.', '没有打开的会话。', 'Tidak ada percakapan terbuka.'],
	pickSession: ['Pick a session from the sidebar, or start one with + New chat.', '从侧栏选择会话,或以 + 新建聊天开始。', 'Pilih sesi dari bilah samping, atau mulai dengan + Obrolan baru.'],
	closePanel: ['Close panel', '关闭面板', 'Tutup panel'],
	closeLoupe: ['Close loupe', '关闭放大镜', 'Tutup kaca pembesar'],
	panelLoupe: ['Panel loupe — full-size reading view', '面板放大镜 — 全尺寸阅读视图', 'Kaca pembesar panel — tampilan baca ukuran penuh'],
	resizePanel: ['Resize panel', '调整面板大小', 'Ubah ukuran panel'],
	dragResize: ['Drag to resize · Shift+drag resizes all', '拖动调整大小 · Shift+拖动调整全部', 'Seret untuk mengubah ukuran · Shift+seret untuk semua'],
	save: ['Save', '保存', 'Simpan'],
	revert: ['Revert', '还原', 'Kembalikan'],
	revertEdits: ['Revert edits', '还原编辑', 'Kembalikan suntingan'],
	sessionIdToOpen: ['Session id to open as a panel', '要作为面板打开的会话 id', 'ID sesi untuk dibuka sebagai panel'],
	pasteSessionId: ['Paste session id…', '粘贴会话 id…', 'Tempel ID sesi…'],
	add: ['Add', '添加', 'Tambah'],
	openAsPanel: ['Open as panel', '作为面板打开', 'Buka sebagai panel'],
	rplc: ['Rplc', '替换', 'Ganti'],
	replaceActivePanel: ['Replace active panel', '替换活动面板', 'Ganti panel aktif'],
	floorControls: ['Floor controls', '面板控制', 'Kontrol lantai'],
	width: ['Width', '宽度', 'Lebar'],
	panelWidthAll: ['Panel width for all panels', '所有面板的宽度', 'Lebar untuk semua panel'],
	zoom: ['Zoom', '缩放', 'Zoom'],
	floorZoom: ['Floor zoom', '地面缩放', 'Zoom lantai'],
	copyFloorImage: ['Copy panel floor as image (Shift+Click to save)', '将面板地面复制为图片(Shift+点击保存)', 'Salin lantai panel sebagai gambar (Shift+Klik untuk simpan)'],
	floorCapture: ['Floor capture', '地面捕获', 'Tangkapan lantai'],
	closeAbout: ['Close about dialog', '关闭关于对话框', 'Tutup dialog tentang'],
	aboutDsi: ['About Deepseek Insight', '关于 Deepseek Insight', 'Tentang Deepseek Insight'],
	aboutTagline: ['Getting Insight of Deepseek Harness', '洞悉 Deepseek Harness', 'Memperoleh wawasan dari Deepseek Harness'],
	aboutCredit: ['Created by: Widi Harsojo (c) 2026 - Apache License', '作者:Widi Harsojo (c) 2026 - Apache 许可证', 'Dibuat oleh: Widi Harsojo (c) 2026 - Lisensi Apache'],
	clearFilters: ['Clear every filter', '清除所有筛选', 'Hapus semua filter'],
	all: ['All', '全部', 'Semua'],
	filterBy: ['Filter by', '筛选', 'Filter menurut'],
	onlyNeverPrompted: ['Only never-prompted (empty) sessions', '仅显示从未提示的(空)会话', 'Hanya sesi tanpa prompt (kosong)'],
	onlyWithConversation: ['Only sessions with at least one conversation', '仅显示至少有一次对话的会话', 'Hanya sesi dengan minimal satu percakapan'],
	onlyEnabledWorkspaces: ['Only sessions in registered (enabled) workspaces', '仅显示已注册(启用)工作区的会话', 'Hanya sesi di workspace terdaftar (aktif)'],
	filterCountOrWorkspace: ['Filter by conversation count or workspace', '按对话数量或工作区筛选', 'Filter menurut jumlah percakapan atau workspace'],
	collapseLineage: ['Collapse all sessions with lineage', '折叠所有有谱系的会话', 'Ciutkan semua sesi bergaris keturunan'],
	expandLineage: ['Expand all sessions with lineage', '展开所有有谱系的会话', 'Bentangkan semua sesi bergaris keturunan'],
	lineageFold: ['Lineage fold', '谱系折叠', 'Lipatan garis keturunan'],
	sessions: ['Sessions', '会话', 'Sesi'],
	filterBySessionName: ['Filter by session name...', '按会话名称筛选…', 'Filter menurut nama sesi...'],
	filterBySessionNameLabel: ['Filter by session name', '按会话名称筛选', 'Filter menurut nama sesi'],
	workspaceActions: ['Workspace actions', '工作区操作', 'Aksi workspace'],
	backToWorkspace: ['← Back to the workspace', '← 返回工作区', '← Kembali ke workspace']
};

for (const locale of ['en', 'zh', 'id']) {
	const f = resolve(ROOT, 'messages/' + locale + '.json');
	const doc = JSON.parse(readFileSync(f, 'utf8'));
	let fixed = 0;
	for (const [k, triple] of Object.entries(C)) {
		const v = triple[locale === 'en' ? 0 : locale === 'zh' ? 1 : 2];
		if (doc[k] !== v) { doc[k] = v; fixed++; }
	}
	writeFileSync(f, JSON.stringify(doc, null, '\t') + '\n');
	console.log(locale + '.json fixed:', fixed);
}
