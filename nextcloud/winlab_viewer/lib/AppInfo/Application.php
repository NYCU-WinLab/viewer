<?php

declare(strict_types=1);

namespace OCA\WinlabViewer\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\WinlabViewer\Listener\LoadScripts;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

class Application extends App implements IBootstrap {
	public const APP_ID = 'winlab_viewer';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadScripts::class);
	}

	public function boot(IBootContext $context): void {
	}
}
