/**
 * File Eye lanes (2026-09-13 operator request): clampPanelWidth clamps
 * each workspace kind in its OWN band. Settings Tree D1 (2026-09-18) made
 * it ONE wide lane: the explorer and the file panel both clamp into
 * 520..1436 (default 850), while conversation panels keep the tuned
 * bounds, and the width slider (resizeAll) never touches workspace lanes.
 */
import { describe, expect, it } from 'vitest';

import {
	PANEL_WORKSPACE_EXPLORER_WIDTH,
	PANEL_WORKSPACE_FILE_MAX_WIDTH,
	PANEL_WORKSPACE_FILE_MIN_WIDTH,
	PANEL_WORKSPACE_FILE_WIDTH,
	clampPanelWidth
} from '$lib/utils/panel-prefs';

describe('File Eye width lanes (clampPanelWidth per kind)', () => {
	it('the explorer clamps into the wide 520..1436 band (Settings Tree D1 — one lane)', () => {
		expect(clampPanelWidth(100, 'workspace-explorer')).toBe(520);
		expect(clampPanelWidth(520, 'workspace-explorer')).toBe(520);
		expect(clampPanelWidth(850, 'workspace-explorer')).toBe(850);
		expect(clampPanelWidth(1000, 'workspace-explorer')).toBe(1000);
		expect(clampPanelWidth(2000, 'workspace-explorer')).toBe(1436);
	});

	it('the file panel clamps into the 520..1436 band (default 850)', () => {
		expect(clampPanelWidth(600, 'workspace-file')).toBe(600);
		expect(clampPanelWidth(520, 'workspace-file')).toBe(520);
		expect(clampPanelWidth(850, 'workspace-file')).toBe(850);
		expect(clampPanelWidth(1100, 'workspace-file')).toBe(1100);
		expect(clampPanelWidth(2000, 'workspace-file')).toBe(1436);
	});

	it('conversation panels keep the tuned bounds (floor 480)', () => {
		expect(clampPanelWidth(100, 'conversation')).toBe(480);
		expect(clampPanelWidth(100)).toBe(480);
	});

	it('the lane constants match the operator request', () => {
		expect(PANEL_WORKSPACE_FILE_WIDTH).toBe(850);
		expect(PANEL_WORKSPACE_FILE_MIN_WIDTH).toBe(520);
		expect(PANEL_WORKSPACE_FILE_MAX_WIDTH).toBe(1436);
		expect(PANEL_WORKSPACE_EXPLORER_WIDTH).toBe(280);
	});
});
