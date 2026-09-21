<script lang="ts">
	import SettingsSkillsContainer from '$lib/components/panels/SettingsSkillsContainer.svelte';
	// Implicit children snippet: the host passes real markup so the
	// container's {@render children()} is exercised for real.
</script>

<SettingsSkillsContainer>
	<p data-testid="container-inner">inner</p>
</SettingsSkillsContainer>
