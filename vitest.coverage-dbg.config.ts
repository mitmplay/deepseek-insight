import { mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, {
	test: {
		coverage: {
			reporter: ['json', 'text'],
			reportsDirectory: './coverage-dbg',
			include: ['src/lib/components/composer/access-mode/AccessModeConfirm.svelte', 'src/lib/components/message/chips/RuntimeContextChip.svelte'],
			thresholds: { perFile: false }
		}
	}
});
