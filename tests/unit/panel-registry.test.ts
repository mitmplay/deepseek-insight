/**
 * Unit: panel-registry — the ONLY leaf→root action channel of the panel
 * floor (ADR-0006). Covers the register/invoke contract: args pass-through,
 * no-handler false, register(null) clears, re-register replaces, and
 * invoke-after-destroy (all slots cleared) returns false for every action
 * (commitment 8 — a stale handler after page destroy is a spec failure).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addPanelFromSidebar,
	movePanelFromRegistry,
	registerAddPanel,
	registerMovePanel,
	registerReplaceSelected,
	registerSelectPanel,
	registerStartPanelResize,
	replaceSelectedFromRegistry,
	selectPanelFromRegistry,
	startPanelResize,
	type PanelAddRequest
} from '$lib/services/panels/panel-registry';

/** Clear every slot — the route's destroy lifecycle. */
function unregisterAll(): void {
	registerAddPanel(null);
	registerReplaceSelected(null);
	registerSelectPanel(null);
	registerStartPanelResize(null);
	registerMovePanel(null);
}

afterEach(unregisterAll);

describe('panel-registry', () => {
	it('register→invoke passes args through to the handler (add)', () => {
		const handler = vi.fn();
		registerAddPanel(handler);
		const request: PanelAddRequest = { sessionId: 'sess-1', agentPreset: 'deepseek' };
		expect(addPanelFromSidebar(request)).toBe(true);
		expect(handler).toHaveBeenCalledExactlyOnceWith(request);
	});

	it('invoke without a handler returns false (graceful no-op)', () => {
		const request: PanelAddRequest = { sessionId: 'sess-1', agentPreset: null };
		expect(addPanelFromSidebar(request)).toBe(false);
		expect(replaceSelectedFromRegistry(request)).toBe(false);
		expect(selectPanelFromRegistry('panel-1')).toBe(false);
		expect(startPanelResize(new MouseEvent('mousedown'), 0)).toBe(false);
		expect(movePanelFromRegistry('panel-1', 'left')).toBe(false);
	});

	it('register(null) clears the slot — invoke returns false afterwards', () => {
		registerAddPanel(vi.fn());
		registerAddPanel(null);
		expect(addPanelFromSidebar({ sessionId: 's', agentPreset: null })).toBe(false);
	});

	it('re-register replaces the previous handler (last one wins)', () => {
		const first = vi.fn();
		const second = vi.fn();
		registerAddPanel(first);
		registerAddPanel(second);
		addPanelFromSidebar({ sessionId: 's', agentPreset: null });
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});

	it('invoke-after-destroy (all slots cleared) returns false for every action', () => {
		registerAddPanel(vi.fn());
		registerReplaceSelected(vi.fn());
		registerSelectPanel(vi.fn());
		registerStartPanelResize(vi.fn());
		registerMovePanel(vi.fn());
		unregisterAll();
		const request: PanelAddRequest = { sessionId: 'sess-2', agentPreset: 'writer' };
		expect(addPanelFromSidebar(request)).toBe(false);
		expect(replaceSelectedFromRegistry(request)).toBe(false);
		expect(selectPanelFromRegistry('panel-2')).toBe(false);
		expect(startPanelResize(new MouseEvent('mousedown'), 3)).toBe(false);
		expect(movePanelFromRegistry('panel-2', 'down')).toBe(false);
	});

	it('replace and select pass their distinct args through', () => {
		const replace = vi.fn();
		const select = vi.fn();
		registerReplaceSelected(replace);
		registerSelectPanel(select);
		const request: PanelAddRequest = { sessionId: 'sess-3', agentPreset: null };
		expect(replaceSelectedFromRegistry(request)).toBe(true);
		expect(replace).toHaveBeenCalledExactlyOnceWith(request);
		expect(selectPanelFromRegistry('panel-3')).toBe(true);
		expect(select).toHaveBeenCalledExactlyOnceWith('panel-3');
	});

	it('startPanelResize passes the mouse event and index through', () => {
		const resize = vi.fn();
		registerStartPanelResize(resize);
		const event = new MouseEvent('mousedown');
		expect(startPanelResize(event, 2)).toBe(true);
		expect(resize).toHaveBeenCalledExactlyOnceWith(event, 2);
	});

	it('movePanel passes the panel id and every direction through', () => {
		const move = vi.fn();
		registerMovePanel(move);
		for (const dir of ['left', 'right', 'up', 'down'] as const) {
			expect(movePanelFromRegistry('panel-4', dir)).toBe(true);
		}
		expect(move).toHaveBeenNthCalledWith(1, 'panel-4', 'left');
		expect(move).toHaveBeenNthCalledWith(2, 'panel-4', 'right');
		expect(move).toHaveBeenNthCalledWith(3, 'panel-4', 'up');
		expect(move).toHaveBeenNthCalledWith(4, 'panel-4', 'down');
	});
});
