<?php
/** @var array $_ */
?>
<div id="winlab-viewer" style="width: 100%; height: calc(100vh - var(--header-height, 50px));">
	<iframe
		title="<?php p($_['name']); ?>"
		src="<?php p($_['src']); ?>"
		allow="clipboard-write; fullscreen"
		style="width: 100%; height: 100%; border: 0; display: block;"></iframe>
</div>
